import type {
	BaseHookInput,
	PostToolUseHookSpecificOutput,
	SyncHookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import type { FileEditInput, FileWriteInput } from "@anthropic-ai/claude-agent-sdk/sdk-tools";

import { createFromFile } from "file-entry-cache";
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	globSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";

export type LintCadence = "stop-only" | "strict" | "tiered";

export const LINT_CADENCE_VALUES: ReadonlyArray<LintCadence> = ["stop-only", "strict", "tiered"];

export interface LintSettings {
	cacheBust: Array<string>;
	debug: boolean;
	eslint: boolean;
	lint: boolean;
	lintAutoFixOnBatch: boolean;
	lintCadence: LintCadence;
	maxLintAttempts: number;
	maxLintErrors: number;
	oxlint: boolean;
	runner: string;
	typecheck: boolean;
	typecheckArgs: Array<string>;
}

export type DependencyGraph = Record<string, Array<string>>;

type PostToolUseHookOutput = SyncHookJSONOutput & {
	hookSpecificOutput?: PostToolUseHookSpecificOutput;
};

const POWERSHELL_EXE = "powershell.exe";
const POWERSHELL_NO_PROFILE = "-NoProfile";

function spawnBackground(script: string, extraEnvironment: Record<string, string> = {}): void {
	const scriptFile = join(
		tmpdir(),
		`.eslint_bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.cjs`,
	);
	writeFileSync(scriptFile, script);

	const environment = { ...process.env, ...extraEnvironment };

	if (process.platform === "win32") {
		spawnSync(
			POWERSHELL_EXE,
			[
				POWERSHELL_NO_PROFILE,
				"-Command",
				`Start-Process -FilePath 'node' -ArgumentList '${scriptFile}' -WindowStyle Hidden`,
			],
			{ env: environment, stdio: "ignore", windowsHide: true },
		);
	} else {
		const child = spawn("node", [scriptFile], {
			detached: true,
			env: environment,
			stdio: "ignore",
		});

		child.unref();
	}
}

const PROTECTED_PATTERNS = ["eslint.config.", "oxlint.config.", ".eslintrc", ".oxlintrc."];

export function isProtectedFile(filename: string): boolean {
	return PROTECTED_PATTERNS.some(
		(pattern) => filename.startsWith(pattern) || filename === pattern,
	);
}

const LINT_STATE_PATH = ".claude/state/lint-attempts.json";
const STOP_STATE_PATH = ".claude/state/stop-attempts.json";
const TYPECHECK_STOP_STATE_PATH = ".claude/state/typecheck-stop-attempts.json";
const EDITED_FILES_PATH = ".claude/state/edited-files.json";
const SESSIONS_DIR = ".claude/state/sessions";
const RESTART_DAEMON_LOG = ".claude/state/restartDaemon.log";

const IS_RESTART_DAEMON_DEBUG = false as boolean;
const CLAUDE_PID_PATH = ".claude/state/claude-pid";

interface EditedFilesBucket {
	edited: Array<string>;
	lastSurfacedAt: null | number;
}

type EditedFilesState = Record<string, EditedFilesBucket>;

interface EditOrWriteHookInput {
	// eslint-disable-next-line flawless/naming-convention -- mirrors SDK shape
	tool_input: unknown;
	// eslint-disable-next-line flawless/naming-convention -- mirrors SDK shape
	tool_name: string;
}

type FilePathInput = Pick<FileEditInput | FileWriteInput, "file_path">;

/**
 * Composite bucket key for state isolation between main thread and subagents.
 * Returns `<session_id>:main` on the main thread, `<session_id>:<agent_id>` from
 * inside a subagent. Subagents share `session_id` with the parent but get a
 * distinct `agent_id`, so this composite cleanly partitions state.
 *
 * @param input - SDK hook input containing `session_id` and optional `agent_id`.
 * @returns Bucket key suitable for the edited-files state map.
 */
export function getBucketKey(input: BaseHookInput): string {
	return `${input.session_id}:${input.agent_id ?? "main"}`;
}

/**
 * Narrows `tool_input` for `Edit`/`Write` tool hooks. Both tools always
 * populate `file_path`, but the SDK types `tool_input` as `unknown` so this
 * helper restores the discriminated shape with a runtime check.
 *
 * Caller must verify `input.tool_name` is `"Edit"` or `"Write"` first.
 *
 * @param input - SDK hook input narrowed to `Edit` or `Write` tools.
 * @returns Object containing the validated `file_path` string.
 * @throws If `tool_input` is not an object or `file_path` is missing or empty.
 */
export function narrowToolInput(input: EditOrWriteHookInput): FilePathInput {
	const toolInput = input.tool_input;
	if (typeof toolInput !== "object" || toolInput === null) {
		throw new TypeError(
			`Expected ${input.tool_name} tool_input to be an object, got ${typeof toolInput}`,
		);
	}

	const filePath = (toolInput as Record<string, unknown>)["file_path"];
	if (typeof filePath !== "string" || filePath === "") {
		throw new TypeError(
			`Expected ${input.tool_name} tool_input.file_path to be a non-empty string`,
		);
	}

	return { file_path: filePath };
}

export function readEditedFiles(bucketKey: string): Array<string> {
	const state = readState();
	return state[bucketKey]?.edited ?? [];
}

export function writeEditedFile(bucketKey: string, filePath: string): void {
	const state = readState();
	const bucket = state[bucketKey] ?? { edited: [], lastSurfacedAt: null };
	if (!bucket.edited.includes(filePath)) {
		bucket.edited.push(filePath);
	}

	state[bucketKey] = bucket;
	mkdirSync(dirname(EDITED_FILES_PATH), { recursive: true });
	writeFileSync(EDITED_FILES_PATH, JSON.stringify(state));
}

export function clearEditedFiles(bucketKey: string): void {
	if (!existsSync(EDITED_FILES_PATH)) {
		return;
	}

	let state: EditedFilesState;
	try {
		state = JSON.parse(readFileSync(EDITED_FILES_PATH, "utf-8")) as unknown as EditedFilesState;
	} catch {
		unlinkSync(EDITED_FILES_PATH);
		return;
	}

	if (!(bucketKey in state)) {
		return;
	}

	delete state[bucketKey];

	if (Object.keys(state).length === 0) {
		unlinkSync(EDITED_FILES_PATH);
	} else {
		writeFileSync(EDITED_FILES_PATH, JSON.stringify(state));
	}
}

/**
 * Register the active session with the live-session registry. Writes the claude
 * PID into `.claude/state/sessions/<sessionId>` so concurrent chats — and the
 * `pruneDeadSessions` sweep at `SessionStart` — can tell a live session from a
 * crashed one. Idempotent: overwrites the lockfile each call to refresh the PID
 * across `resume`/`clear`/`compact`.
 *
 * @param sessionId - SDK-provided `session_id`.
 * @param pid - PID string to record (typically from {@link getClaudePid}).
 */
export function registerSession(sessionId: string, pid: string): void {
	mkdirSync(SESSIONS_DIR, { recursive: true });
	writeFileSync(join(SESSIONS_DIR, sessionId), pid);
}

/**
 * Walk the session registry and return the set of session IDs whose recorded
 * PID still has a live process. Entries whose PID is dead (or whose contents
 * are malformed) are unlinked as a side effect — the registry self-cleans.
 *
 * @returns Set of session IDs whose owning claude process is still alive.
 */
export function loadLiveSessions(): Set<string> {
	const live = new Set<string>();
	if (!existsSync(SESSIONS_DIR)) {
		return live;
	}

	for (const entry of readdirSync(SESSIONS_DIR)) {
		const lockfile = join(SESSIONS_DIR, entry);
		const pid = Number(readFileSync(lockfile, "utf-8").trim());
		if (Number.isFinite(pid)) {
			try {
				process.kill(pid, 0);
				live.add(entry);
				continue;
			} catch {
				// dead pid → fall through to unlink
			}
		}

		try {
			unlinkSync(lockfile);
		} catch {
			// best-effort
		}
	}

	return live;
}

/**
 * Drop every per-session entry whose owning session is no longer in the
 * registry. Sweeps all four state files: `lint-attempts.json` (sessionId
 * keys), `stop-attempts.json` and `typecheck-stop-attempts.json` (bucketKey
 * keys), and `edited-files.json` (bucketKey keys). For bucketKey-shaped files
 * the prefix before the first `:` is the sessionId. Unlinks any file whose
 * surviving map is empty.
 *
 * @param liveSessions - Set returned by {@link loadLiveSessions}.
 */
export function pruneDeadSessions(liveSessions: Set<string>): void {
	pruneStateBySessionId(LINT_STATE_PATH, liveSessions);
	pruneStateByBucketKey(STOP_STATE_PATH, liveSessions);
	pruneStateByBucketKey(TYPECHECK_STOP_STATE_PATH, liveSessions);
	pruneStateByBucketKey(EDITED_FILES_PATH, liveSessions);
}

/**
 * Mark a bucket as surfaced at the given timestamp (defaults to now). Used by
 * surface-gating logic to track which edits have already been reported to the
 * agent. Hooks call this after emitting a diagnostics surface so subsequent
 * surfaces only include edits made since.
 *
 * @param bucketKey - Bucket to mark; see {@link getBucketKey}.
 * @param timestamp - Surface time in ms since epoch; defaults to `Date.now()`.
 */
export function markBucketSurfaced(bucketKey: string, timestamp: number = Date.now()): void {
	const state = readState();
	const bucket = state[bucketKey] ?? { edited: [], lastSurfacedAt: null };
	bucket.edited = [];
	bucket.lastSurfacedAt = timestamp;
	state[bucketKey] = bucket;
	mkdirSync(dirname(EDITED_FILES_PATH), { recursive: true });
	writeFileSync(EDITED_FILES_PATH, JSON.stringify(state));
}

export function getLastSurfacedAt(bucketKey: string): null | number {
	const state = readState();
	return state[bucketKey]?.lastSurfacedAt ?? null;
}

export function getTransitiveDependents(
	files: Array<string>,
	sourceRoot: string,
	runner = DEFAULT_SETTINGS.runner,
): Array<string> {
	const entryPoints = findEntryPoints(sourceRoot);
	if (entryPoints.length === 0) {
		return [];
	}

	const graph = getDependencyGraph(sourceRoot, entryPoints, runner);

	const visited = new Set<string>();
	const queue: Array<string> = [];

	for (const file of files) {
		const relativePath = relative(sourceRoot, resolve(file)).replaceAll("\\", "/");
		if (!visited.has(relativePath)) {
			visited.add(relativePath);
			queue.push(relativePath);
		}
	}

	let current = queue.shift();
	while (current !== undefined) {
		const importers = invertGraph(graph, current);
		for (const importer of importers) {
			if (!visited.has(importer)) {
				visited.add(importer);
				queue.push(importer);
			}
		}

		current = queue.shift();
	}

	const originals = new Set(
		files.map((file) => relative(sourceRoot, resolve(file)).replaceAll("\\", "/")),
	);

	return [...visited]
		.filter((file) => !originals.has(file))
		.map((file) => join(sourceRoot, file));
}

export function getClaudePid(): string | undefined {
	const ssePort = process.env["CLAUDE_CODE_SSE_PORT"] ?? "";
	const cacheFile = ssePort.length > 0 ? `${CLAUDE_PID_PATH}-${ssePort}` : CLAUDE_PID_PATH;

	if (existsSync(cacheFile)) {
		try {
			const cached = readFileSync(cacheFile, "utf-8").trim();
			const pid = Number(cached);
			process.kill(pid, 0);
			return cached;
		} catch {
			// cached PID is dead, re-discover
		}
	}

	if (process.platform === "win32") {
		try {
			const script = `
$currentPid = ${process.ppid}
while ($currentPid -and $currentPid -ne 0) {
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$currentPid" -Property Name,ParentProcessId -ErrorAction SilentlyContinue
  if (-not $p) { break }
  if ($p.Name -eq 'claude.exe') { Write-Output $currentPid; exit }
  $currentPid = $p.ParentProcessId
}`;
			const result = execFileSync(
				POWERSHELL_EXE,
				[POWERSHELL_NO_PROFILE, "-Command", script],
				{
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 5_000,
				},
			).trim();
			if (result.length > 0) {
				mkdirSync(dirname(cacheFile), { recursive: true });
				writeFileSync(cacheFile, result);
				return result;
			}
		} catch {
			// fallback to no PPID
		}
	}

	return undefined;
}

function readState(): EditedFilesState {
	if (!existsSync(EDITED_FILES_PATH)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(EDITED_FILES_PATH, "utf-8")) as unknown as EditedFilesState;
	} catch {
		return {};
	}
}

function pruneStateFile(path: string, keepKey: (key: string) => boolean): void {
	if (!existsSync(path)) {
		return;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		unlinkSync(path);
		return;
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		unlinkSync(path);
		return;
	}

	const state = parsed as Record<string, unknown>;
	const survivors = {} satisfies Record<string, unknown> as Record<string, unknown>;
	let hasDropped = false;
	for (const [key, value] of Object.entries(state)) {
		if (keepKey(key)) {
			survivors[key] = value;
		} else {
			hasDropped = true;
		}
	}

	if (!hasDropped) {
		return;
	}

	if (Object.keys(survivors).length === 0) {
		unlinkSync(path);
	} else {
		writeFileSync(path, JSON.stringify(survivors));
	}
}

function pruneStateBySessionId(path: string, liveSessions: Set<string>): void {
	pruneStateFile(path, (key) => liveSessions.has(key));
}

function pruneStateByBucketKey(path: string, liveSessions: Set<string>): void {
	pruneStateFile(path, (key) => {
		const sessionId = key.split(":", 1)[0] ?? key;
		return liveSessions.has(sessionId);
	});
}

const ESLINT_CACHE_PATH = ".eslintcache";
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".json"];
const ENTRY_CANDIDATES = ["index.ts", "cli.ts", "main.ts"];

const SETTINGS_FILE = ".claude/sentinel.local.md";

export const DEFAULT_CACHE_BUST = ["*.config.*", "**/tsconfig*.json"];

const DEFAULT_MAX_LINT_ATTEMPTS = 1;
const DEFAULT_MAX_STOP_ATTEMPTS = 1;
const DEFAULT_MAX_LINT_ERRORS = 10;
const DEFAULT_LINT_CADENCE: LintCadence = "strict";

const DEFAULT_SETTINGS = {
	cacheBust: [...DEFAULT_CACHE_BUST],
	debug: false,
	eslint: true,
	lint: true,
	lintAutoFixOnBatch: true,
	lintCadence: DEFAULT_LINT_CADENCE,
	maxLintAttempts: DEFAULT_MAX_LINT_ATTEMPTS,
	maxLintErrors: DEFAULT_MAX_LINT_ERRORS,
	oxlint: false,
	runner: "pnpm exec",
	typecheck: true,
	typecheckArgs: [],
} satisfies LintSettings;

export interface StopDecisionResult {
	decision?: "block";
	reason?: string;
	resetStopAttempts?: true;
}

export interface FormattedErrors {
	lines: Array<string>;
	totalIssues: number;
}

interface StopDecisionInput {
	errorFiles: Array<string>;
	lintAttempts: Record<string, number>;
	maxLintAttempts: number;
	stopAttempts: number;
}

type LintAttemptsState = Record<string, Record<string, number>>;

type StopAttemptsState = Record<string, number>;

export function readSettings(): LintSettings {
	if (!existsSync(SETTINGS_FILE)) {
		return { ...DEFAULT_SETTINGS };
	}

	const content = readFileSync(SETTINGS_FILE, "utf-8");
	const fields = parseFrontmatter(content);

	const cacheBustRaw = fields.get("cache-bust") ?? "";
	const userPatterns = cacheBustRaw
		? cacheBustRaw
				.split(",")
				.map((entry) => entry.trim())
				.filter(Boolean)
		: [];

	const maxAttemptsRaw = fields.get("max-lint-attempts");
	const maxAttemptsParsed = maxAttemptsRaw !== undefined ? Number(maxAttemptsRaw) : Number.NaN;
	const maxLintAttempts = Number.isFinite(maxAttemptsParsed)
		? maxAttemptsParsed
		: DEFAULT_MAX_LINT_ATTEMPTS;

	const maxErrorsRaw = fields.get("max-lint-errors");
	const maxErrorsParsed = maxErrorsRaw !== undefined ? Number(maxErrorsRaw) : Number.NaN;
	const maxLintErrors = Number.isFinite(maxErrorsParsed)
		? maxErrorsParsed
		: DEFAULT_MAX_LINT_ERRORS;

	const cadenceRaw = fields.get("lint-cadence");
	const lintCadence: LintCadence =
		cadenceRaw !== undefined &&
		(LINT_CADENCE_VALUES as ReadonlyArray<string>).includes(cadenceRaw)
			? (cadenceRaw as LintCadence)
			: DEFAULT_LINT_CADENCE;

	return {
		cacheBust: [...DEFAULT_CACHE_BUST, ...userPatterns],
		debug: fields.get("debug") === "true",
		eslint: fields.get("eslint") !== "false",
		lint: fields.get("lint") !== "false",
		lintAutoFixOnBatch: parseAutoFixOnBatch(fields.get("lint-auto-fix-on-batch")),
		lintCadence,
		maxLintAttempts,
		maxLintErrors,
		oxlint: fields.get("oxlint") === "true",
		runner: fields.get("runner") ?? DEFAULT_SETTINGS.runner,
		typecheck: fields.get("typecheck") !== "false",
		typecheckArgs: (fields.get("typecheck-args") ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean),
	};
}

export function getChangedFiles(): Array<string> {
	const options = { encoding: "utf-8" as const, stdio: "pipe" as const };
	const changed = execSync("git diff --name-only --diff-filter=d HEAD", options);
	const untracked = execSync("git ls-files --others --exclude-standard", options);
	return [...changed.trim().split("\n"), ...untracked.trim().split("\n")]
		.filter(Boolean)
		.filter((file) => !file.startsWith(".."));
}

export function isInProject(filePath: string): boolean {
	const projectDirectory = process.env["CLAUDE_PROJECT_DIR"];
	if (projectDirectory === undefined || projectDirectory === "") {
		return true;
	}

	const resolvedFile = resolve(filePath);
	const resolvedProject = resolve(projectDirectory);

	if (resolvedFile === resolvedProject) {
		return true;
	}

	const prefix = resolvedProject + sep;
	return process.platform === "win32"
		? resolvedFile.toLowerCase().startsWith(prefix.toLowerCase())
		: resolvedFile.startsWith(prefix);
}

export function isLintableFile(filePath: string, extensions = DEFAULT_EXTENSIONS): boolean {
	return extensions.some((extension) => filePath.endsWith(extension));
}

export function findEntryPoints(sourceRoot: string): Array<string> {
	return ENTRY_CANDIDATES.map((name) => join(sourceRoot, name)).filter((path) => {
		return existsSync(path);
	});
}

export function getDependencyGraph(
	sourceRoot: string,
	entryPoints: Array<string>,
	runner = DEFAULT_SETTINGS.runner,
): DependencyGraph {
	const entryArguments = entryPoints.map((ep) => `"${ep}"`).join(" ");
	const output = execSync(`${runner} madge --json ${entryArguments}`, {
		cwd: sourceRoot,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
		timeout: 30_000,
	});

	return JSON.parse(output) as DependencyGraph;
}

export function invertGraph(graph: DependencyGraph, target: string): Array<string> {
	const importers: Array<string> = [];
	for (const [file, dependencies] of Object.entries(graph)) {
		if (dependencies.includes(target)) {
			importers.push(file);
		}
	}

	return importers;
}
export function findSourceRoot(filePath: string): string | undefined {
	let current = dirname(filePath);
	while (current !== dirname(current)) {
		if (existsSync(join(current, "package.json"))) {
			const sourceDirectory = join(current, "src");
			if (existsSync(sourceDirectory)) {
				return sourceDirectory;
			}

			return current;
		}

		current = dirname(current);
	}

	return undefined;
}

export function readLintAttempts(sessionId: string): Record<string, number> {
	const state = readLintAttemptsState();
	return state[sessionId] ?? {};
}

export function writeLintAttempts(sessionId: string, attempts: Record<string, number>): void {
	const state = readLintAttemptsState();
	state[sessionId] = attempts;
	writeLintAttemptsState(state);
}

export function incrementLintAttempt(sessionId: string, filePath: string): number {
	const state = readLintAttemptsState();
	const attempts = state[sessionId] ?? {};
	const count = (attempts[filePath] ?? 0) + 1;
	attempts[filePath] = count;
	state[sessionId] = attempts;
	writeLintAttemptsState(state);
	return count;
}

export function clearLintAttempt(sessionId: string, filePath: string): void {
	const state = readLintAttemptsState();
	const attempts = state[sessionId];
	if (attempts === undefined || !(filePath in attempts)) {
		return;
	}

	delete attempts[filePath];
	if (Object.keys(attempts).length === 0) {
		delete state[sessionId];
	} else {
		state[sessionId] = attempts;
	}

	if (Object.keys(state).length === 0) {
		unlinkSync(LINT_STATE_PATH);
	} else {
		writeLintAttemptsState(state);
	}
}

export function readStopAttempts(bucketKey: string): number {
	return readStopAttemptsState(STOP_STATE_PATH)[bucketKey] ?? 0;
}

export function writeStopAttempts(bucketKey: string, count: number): void {
	const state = readStopAttemptsState(STOP_STATE_PATH);
	state[bucketKey] = count;
	writeStopAttemptsState(STOP_STATE_PATH, state);
}

export function stopDecision(input: StopDecisionInput): StopDecisionResult | undefined {
	if (input.errorFiles.length === 0) {
		if (input.stopAttempts > 0) {
			return { resetStopAttempts: true };
		}

		return undefined;
	}

	const isAllMaxed = input.errorFiles.every((file) => {
		const attempts = findAttempts(file, input.lintAttempts);
		return attempts >= input.maxLintAttempts;
	});
	if (isAllMaxed) {
		return undefined;
	}

	const fileList = input.errorFiles.join(", ");
	if (input.stopAttempts >= DEFAULT_MAX_STOP_ATTEMPTS) {
		return {
			reason: `<workspace_diagnostics source="eslint">\nUnresolved lint issues remain in: ${fileList}. They may be pre-existing.\n</workspace_diagnostics>`,
		};
	}

	return {
		decision: "block",
		reason: `<workspace_diagnostics source="eslint">\nLint issues remain in: ${fileList}. If related to recent changes, address before continuing?\n</workspace_diagnostics>`,
	};
}

export function resolveBustFiles(patterns: Array<string>): Array<string> {
	const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
	const negative = patterns
		.filter((pattern) => pattern.startsWith("!"))
		.map((pattern) => pattern.slice(1));

	const matched = positive.flatMap((pattern) => globSync(pattern));
	if (negative.length === 0) {
		return matched;
	}

	const excluded = new Set(negative.flatMap((pattern) => globSync(pattern)));
	return matched.filter((file) => !excluded.has(file));
}

export function shouldBustCache(patterns: Array<string>): boolean {
	if (patterns.length === 0) {
		return false;
	}

	if (!existsSync(ESLINT_CACHE_PATH)) {
		return false;
	}

	const files = resolveBustFiles(patterns);
	if (files.length === 0) {
		return false;
	}

	const cacheMtime = statSync(ESLINT_CACHE_PATH).mtimeMs;
	return files.some((file) => statSync(file).mtimeMs > cacheMtime);
}

export function clearCache(): void {
	if (existsSync(ESLINT_CACHE_PATH)) {
		unlinkSync(ESLINT_CACHE_PATH);
	}
}

export function invalidateCacheEntries(filePaths: Array<string>): void {
	if (filePaths.length === 0) {
		return;
	}

	if (!existsSync(ESLINT_CACHE_PATH)) {
		return;
	}

	const cache = createFromFile(ESLINT_CACHE_PATH);
	for (const file of filePaths) {
		cache.removeEntry(file);
	}

	cache.reconcile();
}

const MAX_COMMAND_LENGTH = 32_000;

export function runOxlint(
	filePaths: Array<string>,
	extraFlags: Array<string> = [],
	runner = DEFAULT_SETTINGS.runner,
): string | undefined {
	if (filePaths.length === 0) {
		return undefined;
	}

	const flags = extraFlags.length > 0 ? `${extraFlags.join(" ")} ` : "";
	const prefix = `${runner} oxlint ${flags}`;
	const chunks = chunkByCommandLength(filePaths, prefix);
	const outputs: Array<string> = [];

	for (const chunk of chunks) {
		try {
			execSync(`${prefix}${quoteFiles(chunk)}`, {
				stdio: "pipe",
			});
		} catch (err_) {
			const err = err_ as { message?: string; stderr?: Buffer; stdout?: Buffer };
			const stdout = err.stdout?.toString() ?? "";
			const stderr = err.stderr?.toString() ?? "";
			const message = err.message ?? "";

			outputs.push(stdout || stderr || message);
		}
	}

	if (outputs.length === 0) {
		return undefined;
	}

	return outputs.join("\n");
}

export function runEslint(
	filePaths: Array<string>,
	extraFlags: Array<string> = [],
	runner = DEFAULT_SETTINGS.runner,
	isInEditor = true,
): string | undefined {
	if (filePaths.length === 0) {
		return undefined;
	}

	const flags = ["--cache", ...extraFlags].join(" ");
	const claudePid = getClaudePid();
	const environment = {
		...process.env,
		...(claudePid !== undefined && { ESLINT_D_PPID: claudePid }),
		...(isInEditor && { ESLINT_IN_EDITOR: "true" }),
	};

	// On Windows, Node's execSync uses CreateProcess with bInheritHandles=TRUE,
	// duplicating every inheritable parent handle into eslint_d and its forked
	// daemon. The daemon outlives the hook, holding CCD pipes open forever and
	// stalling subsequent CCD tool calls. Route through PowerShell's shell-exec
	// branch (no -RedirectStandard*) and let cmd.exe handle > / 2> redirection,
	// so the daemon only inherits the redirect file handles.
	if (process.platform === "win32") {
		return runEslintWindows(filePaths, flags, runner, environment);
	}

	const prefix = `${runner} eslint_d ${flags} `;
	const chunks = chunkByCommandLength(filePaths, prefix);
	const outputs: Array<string> = [];

	for (const chunk of chunks) {
		try {
			execSync(`${prefix}${quoteFiles(chunk)}`, { env: environment, stdio: "pipe" });
		} catch (err_) {
			const err = err_ as { message?: string; stderr?: Buffer; stdout?: Buffer };
			const stdout = err.stdout?.toString() ?? "";
			const stderr = err.stderr?.toString() ?? "";
			const message = err.message ?? "";

			outputs.push(stdout || stderr || message);
		}
	}

	if (outputs.length === 0) {
		return undefined;
	}

	return outputs.join("\n");
}

export function restartDaemon(
	runner = DEFAULT_SETTINGS.runner,
	warmupFile?: string,
	isInEditor = true,
): void {
	const markerFile = IS_RESTART_DAEMON_DEBUG ? createMarkerPath() : undefined;
	const inEditorLine = isInEditor ? ' ESLINT_IN_EDITOR: "true",' : "";

	try {
		// Spawn a process that runs restart, then warmup lint (sequential)
		const restartAndWarmupScript = `
const { execSync } = require("child_process");
const fs = require("fs");

const runner = ${JSON.stringify(runner)};
const warmupFile = ${JSON.stringify(warmupFile)};
const debug = ${IS_RESTART_DAEMON_DEBUG};
const logFile = ${JSON.stringify(RESTART_DAEMON_LOG)};

try {
  // Run restart
  if (debug) {
    fs.appendFileSync(logFile, \`restart: start \${new Date().toISOString()}\\n\`);
  }
  execSync(\`\${runner} eslint_d restart\`, {
    env: { ...process.env, ESLINT_D_PPID: process.env.ESLINT_D_PPID,${inEditorLine} },
    stdio: "pipe",
  });
  if (debug) {
    fs.appendFileSync(logFile, \`restart: end \${new Date().toISOString()}\\n\`);
  }

  // Run warmup lint if file provided
  if (warmupFile) {
    if (debug) {
      fs.appendFileSync(logFile, \`warmup: start \${warmupFile} \${new Date().toISOString()}\\n\`);
    }
    execSync(\`\${runner} eslint_d "\${warmupFile}"\`, {
      env: { ...process.env, ESLINT_D_PPID: process.env.ESLINT_D_PPID,${inEditorLine} },
      stdio: "pipe",
    });
    if (debug) {
      fs.appendFileSync(logFile, \`warmup: end \${new Date().toISOString()}\\n\`);
    }
  }
} catch (err) {
  if (debug) {
    fs.appendFileSync(logFile, \`error: \${err.message} \${new Date().toISOString()}\\n\`);
  }
} finally {
  try { fs.unlinkSync(process.argv[1]); } catch {}
}
`;

		const claudePid = getClaudePid();
		spawnBackground(restartAndWarmupScript, {
			...(claudePid !== undefined && { ESLINT_D_PPID: claudePid }),
			...(isInEditor && { ESLINT_IN_EDITOR: "true" }),
		});

		if (IS_RESTART_DAEMON_DEBUG && markerFile !== undefined) {
			writeFileSync(RESTART_DAEMON_LOG, `spawn: ${new Date().toISOString()}\n`, {
				flag: "a",
			});
		}

		// If debug, spawn a detached watcher process to poll for completion
		if (markerFile !== undefined) {
			const watcherScript = `
const fs = require("fs");
const logFile = ${JSON.stringify(RESTART_DAEMON_LOG)};

setTimeout(() => {
  try {
    fs.appendFileSync(logFile, \`daemon exit: \${new Date().toISOString()}\\n\`);
  } catch {}
  try { fs.unlinkSync(process.argv[1]); } catch {}
  process.exit(0);
}, 10000);
`;

			spawnBackground(watcherScript);
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`[eslint_d restart] ${message}\n`);
	}
}

function quoteFiles(filePaths: Array<string>): string {
	return filePaths.map((file) => `"${file}"`).join(" ");
}

function chunkByCommandLength(filePaths: Array<string>, prefix: string): Array<Array<string>> {
	const chunks: Array<Array<string>> = [];
	let current: Array<string> = [];
	let currentLength = prefix.length;

	for (const file of filePaths) {
		const segment = current.length === 0 ? `"${file}"` : ` "${file}"`;
		if (current.length > 0 && currentLength + segment.length > MAX_COMMAND_LENGTH) {
			chunks.push(current);
			current = [file];
			currentLength = prefix.length + `"${file}"`.length;
			continue;
		}

		current.push(file);
		currentLength += segment.length;
	}

	if (current.length > 0) {
		chunks.push(current);
	}

	return chunks;
}

function psSingleQuote(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function runEslintWindowsChunk(
	filePaths: Array<string>,
	flags: string,
	runner: string,
	environment: NodeJS.ProcessEnv,
): string | undefined {
	const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	const outFile = join(tmpdir(), `eslint_d_out_${id}.txt`);
	const errFile = join(tmpdir(), `eslint_d_err_${id}.txt`);

	const inner = `${runner} eslint_d ${flags} ${quoteFiles(filePaths)} > "${outFile}" 2> "${errFile}"`;
	const psCmd =
		`$p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', ${psSingleQuote(inner)}) ` +
		"-WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode";

	let exitCode = 0;
	let launcherStderr = "";
	try {
		execFileSync(POWERSHELL_EXE, [POWERSHELL_NO_PROFILE, "-Command", psCmd], {
			env: environment,
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		});
	} catch (err) {
		const error = err as { status?: number; stderr?: Buffer };
		exitCode = error.status ?? 1;
		launcherStderr = error.stderr?.toString().trim() ?? "";
	}

	let stdout = "";
	let stderr = "";
	try {
		stdout = readFileSync(outFile, "utf-8");
	} catch {
		// daemon crashed before writing
	}

	try {
		stderr = readFileSync(errFile, "utf-8");
	} catch {
		// daemon crashed before writing
	}

	try {
		unlinkSync(outFile);
	} catch {
		// best-effort cleanup
	}

	try {
		unlinkSync(errFile);
	} catch {
		// best-effort cleanup
	}

	if (exitCode === 0) {
		return undefined;
	}

	if (stdout || stderr) {
		return stdout || stderr;
	}

	// Nothing in the redirect files — launcher itself failed.
	const detail = launcherStderr.length > 0 ? `: ${launcherStderr}` : "";
	return `error: eslint_d launcher exited with code ${exitCode}${detail}`;
}

function runEslintWindows(
	filePaths: Array<string>,
	flags: string,
	runner: string,
	environment: NodeJS.ProcessEnv,
): string | undefined {
	// cmd.exe expands %VAR% even inside double-quoted strings, so a path or
	// runner containing literal '%' would be rewritten before eslint_d sees
	// it. Reject up front with a clear error rather than silently mis-route.
	const percentFile = filePaths.find((file) => file.includes("%"));
	if (percentFile !== undefined || runner.includes("%")) {
		return `error: lint hook cannot safely run on Windows for paths containing '%' (got filePath=${percentFile ?? ""}, runner=${runner})`;
	}

	const prefix = `${runner} eslint_d ${flags} `;
	const chunks = chunkByCommandLength(filePaths, prefix);
	const outputs: Array<string> = [];

	for (const chunk of chunks) {
		const result = runEslintWindowsChunk(chunk, flags, runner, environment);
		if (result !== undefined) {
			outputs.push(result);
		}
	}

	if (outputs.length === 0) {
		return undefined;
	}

	return outputs.join("\n");
}

function readLintAttemptsState(): LintAttemptsState {
	if (!existsSync(LINT_STATE_PATH)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(LINT_STATE_PATH, "utf-8")) as LintAttemptsState;
	} catch {
		return {};
	}
}

function writeLintAttemptsState(state: LintAttemptsState): void {
	mkdirSync(dirname(LINT_STATE_PATH), { recursive: true });
	writeFileSync(LINT_STATE_PATH, JSON.stringify(state));
}

function readStopAttemptsState(path: string): StopAttemptsState {
	if (!existsSync(path)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(path, "utf-8")) as StopAttemptsState;
	} catch {
		return {};
	}
}

function writeStopAttemptsState(path: string, state: StopAttemptsState): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(state));
}

const RULE_TOKEN_PATTERN = /([\w-]+\/[\w-]+|[\w-]+)$/;

export function formatErrors(output: string, max = DEFAULT_MAX_LINT_ERRORS): FormattedErrors {
	const errorLines = output.split("\n").filter((line) => /error/i.test(line));

	const counts = new Map<string, { count: number; sample: string }>();
	const ungrouped: Array<string> = [];
	for (const line of errorLines) {
		const rule = extractRule(line);
		if (rule === undefined) {
			ungrouped.push(line);
			continue;
		}

		const existing = counts.get(rule);
		if (existing === undefined) {
			counts.set(rule, { count: 1, sample: line });
		} else {
			existing.count += 1;
		}
	}

	const clustered: Array<string> = [];
	for (const [rule, { count, sample }] of counts) {
		clustered.push(count > 1 ? `${sample}  (x${count}, rule: ${rule})` : sample);
	}

	const merged = [...clustered, ...ungrouped];
	return {
		lines: merged.slice(0, max),
		totalIssues: errorLines.length,
	};
}

function extractRule(line: string): string | undefined {
	const trimmed = line.trim();
	const match = RULE_TOKEN_PATTERN.exec(trimmed);
	return match?.[1];
}

const LINT_COMMAND = "pnpm lint";

export function buildHookOutput(
	filePath: string,
	errors: FormattedErrors,
	debugInfo = "",
): PostToolUseHookOutput {
	const remaining = errors.totalIssues - errors.lines.length;
	const errorText = errors.lines.join("\n");
	const overflowSuffix =
		remaining > 0 ? `\n+ ${remaining} more issues — run \`${LINT_COMMAND}\` to see all` : "";

	const issueWord = errors.totalIssues === 1 ? "issue" : "issues";
	const heading = `${filePath} shows ${errors.totalIssues} ${issueWord}:`;
	const body = `${heading}\n${errorText}${overflowSuffix}${debugInfo}`;
	const wrapped = `<workspace_diagnostics source="eslint">\n${body}\n</workspace_diagnostics>`;

	return {
		decision: undefined,
		hookSpecificOutput: {
			additionalContext: wrapped,
			hookEventName: "PostToolUse",
		},
		systemMessage: wrapped,
	};
}

export function lint(
	filePath: string,
	extraFlags: Array<string> = [],
	settings: LintSettings = DEFAULT_SETTINGS,
	{ restart = true } = {},
): PostToolUseHookOutput | undefined {
	if (shouldBustCache(settings.cacheBust)) {
		clearCache();
	} else {
		const importers = findImporters(filePath, settings.runner);
		invalidateCacheEntries(importers);
	}

	const outputs: Array<string> = [];

	if (settings.oxlint) {
		const output = runOxlint([filePath], extraFlags, settings.runner);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	if (settings.eslint) {
		const output = runEslint([filePath], extraFlags, settings.runner);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	let debugInfo = "";
	if (settings.eslint && restart) {
		const startTime = Date.now();
		if (IS_RESTART_DAEMON_DEBUG) {
			writeFileSync(RESTART_DAEMON_LOG, `start: ${new Date().toISOString()}\n`, {
				flag: "a",
			});
		}

		restartDaemon(settings.runner, filePath);
		const elapsed = Date.now() - startTime;
		if (IS_RESTART_DAEMON_DEBUG) {
			writeFileSync(RESTART_DAEMON_LOG, `end: ${new Date().toISOString()}\n`, {
				flag: "a",
			});
			debugInfo = `\n[lint debug] restartDaemon elapsed: ${elapsed}ms`;
		}
	}

	if (outputs.length > 0) {
		const combined = outputs.join("\n");
		const errors = formatErrors(combined);
		if (errors.lines.length > 0) {
			return buildHookOutput(filePath, errors, debugInfo);
		}
	}

	return undefined;
}

export function main(
	targets: Array<string>,
	settings: LintSettings = DEFAULT_SETTINGS,
	isInEditor = false,
): void {
	if (shouldBustCache(settings.cacheBust)) {
		clearCache();
	} else {
		const changedFiles = getChangedFiles();
		invalidateCacheEntries(changedFiles);
	}

	let hasErrors = false;
	const outputs: Array<string> = [];

	if (settings.oxlint) {
		const output = runOxlint(targets, ["--color"], settings.runner);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	if (settings.eslint) {
		const output = runEslint(targets, ["--color"], settings.runner, isInEditor);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	for (const output of outputs) {
		hasErrors = true;
		const filtered = output
			.split("\n")
			.filter((line) => !line.startsWith("["))
			.join("\n")
			.trim();
		if (filtered.length > 0) {
			process.stderr.write(`${filtered}\n`);
		}
	}

	if (settings.eslint) {
		restartDaemon(settings.runner, undefined, isInEditor);
	}

	if (hasErrors) {
		process.exit(1);
	}
}

function findImporters(filePath: string, runner = DEFAULT_SETTINGS.runner): Array<string> {
	const absPath = resolve(filePath);
	const sourceRoot = findSourceRoot(absPath);
	if (sourceRoot === undefined) {
		return [];
	}

	const entryPoints = findEntryPoints(sourceRoot);
	if (entryPoints.length === 0) {
		return [];
	}

	const graph = getDependencyGraph(sourceRoot, entryPoints, runner);
	const targetRelative = relative(sourceRoot, absPath).replaceAll("\\", "/");
	return invertGraph(graph, targetRelative).map((file) => join(sourceRoot, file));
}

function parseAutoFixOnBatch(raw: string | undefined): boolean {
	if (raw === "true") {
		return true;
	}

	if (raw === "false") {
		return false;
	}

	return DEFAULT_SETTINGS.lintAutoFixOnBatch;
}

function parseFrontmatter(content: string): Map<string, string> {
	const fields = new Map<string, string>();
	const match = /^---\n([\s\S]*?)\n---/m.exec(content);
	const frontmatter = match?.[1];
	if (frontmatter === undefined) {
		return fields;
	}

	for (const line of frontmatter.split("\n")) {
		const colon = line.indexOf(":");
		if (colon > 0) {
			const key = line.slice(0, colon).trim();
			const value = line
				.slice(colon + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
			fields.set(key, value);
		}
	}

	return fields;
}

function endsWithSegment(haystack: string, needle: string): boolean {
	if (haystack === needle) {
		return true;
	}

	if (!needle.includes("/")) {
		return false;
	}

	return haystack.endsWith(`/${needle}`);
}

function findAttempts(file: string, lintAttempts: Record<string, number>): number {
	if (file in lintAttempts) {
		// eslint-disable-next-line ts/no-non-null-assertion -- guarded by `in` check
		return lintAttempts[file]!;
	}

	const normalized = file.replaceAll("\\", "/");
	for (const [key, count] of Object.entries(lintAttempts)) {
		const normalizedKey = key.replaceAll("\\", "/");
		if (
			endsWithSegment(normalizedKey, normalized) ||
			endsWithSegment(normalized, normalizedKey)
		) {
			return count;
		}
	}

	return 0;
}

function createMarkerPath(): string {
	const timestamp = Date.now();
	const random = Math.random().toString(36).slice(2, 8);
	return join(tmpdir(), `.eslint_d_${timestamp}_${random}.done`);
}

/* v8 ignore start -- CLI entrypoint */
const IS_CLI_INVOCATION = process.argv[1]?.endsWith("scripts/lint.ts") === true;
if (IS_CLI_INVOCATION) {
	const settings = readSettings();
	const targets = process.argv.length > 2 ? process.argv.slice(2) : ["."];
	main(targets, settings);
}
