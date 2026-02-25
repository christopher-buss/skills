import { createFromFile } from "file-entry-cache";
import { execSync, spawn } from "node:child_process";
import {
	existsSync,
	globSync,
	mkdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

export interface LintSettings {
	cacheBust: Array<string>;
	eslint: boolean;
	lint: boolean;
	maxLintAttempts: number;
	oxlint: boolean;
	runner: string;
}

export type DependencyGraph = Record<string, Array<string>>;

interface HookOutput {
	hookSpecificOutput: {
		additionalContext: string;
		hookEventName: string;
	};
	systemMessage: string;
}

const PROTECTED_PREFIXES = ["eslint.config.", "oxlint.config."];

export function isProtectedFile(filename: string): boolean {
	return PROTECTED_PREFIXES.some((prefix) => filename.startsWith(prefix));
}

const LINT_STATE_PATH = ".claude/state/lint-attempts.json";
const STOP_STATE_PATH = ".claude/state/stop-attempts.json";
const ESLINT_CACHE_PATH = ".eslintcache";
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];
const ENTRY_CANDIDATES = ["index.ts", "cli.ts", "main.ts"];
const MAX_ERRORS = 5;

const SETTINGS_FILE = ".claude/sentinel.local.md";

export const DEFAULT_CACHE_BUST = ["*.config.*", "**/tsconfig*.json"];

const DEFAULT_MAX_LINT_ATTEMPTS = 3;
const DEFAULT_MAX_STOP_ATTEMPTS = 3;

const DEFAULT_SETTINGS = {
	cacheBust: [...DEFAULT_CACHE_BUST],
	eslint: true,
	lint: true,
	maxLintAttempts: DEFAULT_MAX_LINT_ATTEMPTS,
	oxlint: false,
	runner: "pnpm exec",
} satisfies LintSettings;

export interface StopDecisionResult {
	decision?: "block";
	reason: string;
}

interface StopDecisionInput {
	errorFiles: Array<string>;
	lintAttempts: Record<string, number>;
	maxLintAttempts: number;
	stopAttempts: number;
}

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
	const maxLintAttempts =
		maxAttemptsRaw !== undefined ? Number(maxAttemptsRaw) : DEFAULT_MAX_LINT_ATTEMPTS;

	return {
		cacheBust: [...DEFAULT_CACHE_BUST, ...userPatterns],
		eslint: fields.get("eslint") !== "false",
		lint: fields.get("lint") !== "false",
		maxLintAttempts,
		oxlint: fields.get("oxlint") === "true",
		runner: fields.get("runner") ?? DEFAULT_SETTINGS.runner,
	};
}

export function getChangedFiles(): Array<string> {
	const options = { encoding: "utf-8" as const, stdio: "pipe" as const };
	const changed = execSync("git diff --name-only --diff-filter=d HEAD", options);
	const untracked = execSync("git ls-files --others --exclude-standard", options);
	return [...changed.trim().split("\n"), ...untracked.trim().split("\n")].filter(Boolean);
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

export function readLintAttempts(): Record<string, number> {
	if (!existsSync(LINT_STATE_PATH)) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(LINT_STATE_PATH, "utf-8")) as Record<string, number>;
	} catch {
		return {};
	}
}

export function writeLintAttempts(attempts: Record<string, number>): void {
	mkdirSync(dirname(LINT_STATE_PATH), { recursive: true });
	writeFileSync(LINT_STATE_PATH, JSON.stringify(attempts));
}

export function readStopAttempts(): number {
	if (!existsSync(STOP_STATE_PATH)) {
		return 0;
	}

	try {
		return JSON.parse(readFileSync(STOP_STATE_PATH, "utf-8")) as number;
	} catch {
		return 0;
	}
}

export function writeStopAttempts(count: number): void {
	mkdirSync(dirname(STOP_STATE_PATH), { recursive: true });
	writeFileSync(STOP_STATE_PATH, JSON.stringify(count));
}

export function stopDecision(input: StopDecisionInput): StopDecisionResult | undefined {
	if (input.errorFiles.length === 0) {
		return undefined;
	}

	const isAllMaxed = input.errorFiles.every(
		(file) => (input.lintAttempts[file] ?? 0) >= input.maxLintAttempts,
	);
	if (isAllMaxed) {
		return undefined;
	}

	if (input.stopAttempts >= DEFAULT_MAX_STOP_ATTEMPTS) {
		return {
			reason: `Could not fix lint errors in: ${input.errorFiles.join(", ")}`,
		};
	}

	return {
		decision: "block",
		reason: `Lint errors remain in: ${input.errorFiles.join(", ")}. Fix them before stopping.`,
	};
}

export function clearStopAttempts(): void {
	if (existsSync(STOP_STATE_PATH)) {
		unlinkSync(STOP_STATE_PATH);
	}
}

export function clearLintAttempts(): void {
	if (existsSync(LINT_STATE_PATH)) {
		unlinkSync(LINT_STATE_PATH);
	}
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

export function runOxlint(
	filePath: string,
	extraFlags: Array<string> = [],
	runner = DEFAULT_SETTINGS.runner,
): string | undefined {
	const flags = extraFlags.length > 0 ? `${extraFlags.join(" ")} ` : "";
	try {
		execSync(`${runner} oxlint ${flags}"${filePath}"`, {
			stdio: "pipe",
		});
		return undefined;
	} catch (err_) {
		const err = err_ as { message?: string; stderr?: Buffer; stdout?: Buffer };
		const stdout = err.stdout?.toString() ?? "";
		const stderr = err.stderr?.toString() ?? "";
		const message = err.message ?? "";

		return stdout || stderr || message;
	}
}

export function runEslint(
	filePath: string,
	extraFlags: Array<string> = [],
	runner = DEFAULT_SETTINGS.runner,
): string | undefined {
	const flags = ["--cache", ...extraFlags].join(" ");
	try {
		execSync(`${runner} eslint_d ${flags} "${filePath}"`, {
			env: { ...process.env, ESLINT_IN_EDITOR: "true" },
			stdio: "pipe",
		});
		return undefined;
	} catch (err_) {
		const err = err_ as { message?: string; stderr?: Buffer; stdout?: Buffer };
		const stdout = err.stdout?.toString() ?? "";
		const stderr = err.stderr?.toString() ?? "";
		const message = err.message ?? "";

		return stdout || stderr || message;
	}
}

export function restartDaemon(runner = DEFAULT_SETTINGS.runner): void {
	const [command = "pnpm", ...prefixArgs] = runner.split(/\s+/);
	try {
		spawn(command, [...prefixArgs, "eslint_d", "restart"], {
			detached: true,
			env: { ...process.env, ESLINT_IN_EDITOR: "true" },
			stdio: "ignore",
		})
			// eslint-disable-next-line ts/no-empty-function -- intentionally swallow
			.on("error", () => {})
			.unref();
	} catch {
		// swallow
	}
}

export function formatErrors(output: string): Array<string> {
	return output
		.split("\n")
		.filter((line) => /error/i.test(line))
		.slice(0, MAX_ERRORS);
}

export function buildHookOutput(filePath: string, errors: Array<string>): HookOutput {
	const errorText = errors.join("\n");
	const isTruncated = errors.length >= MAX_ERRORS;

	const userMessage = `⚠️ Lint errors in ${filePath}:\n${errorText}${isTruncated ? "\n..." : ""}`;
	const claudeMessage = `⚠️ Lint errors in ${filePath}:\n${errorText}${isTruncated ? "\n(run lint to view more)" : ""}`;

	return {
		hookSpecificOutput: {
			additionalContext: claudeMessage,
			hookEventName: "PostToolUse",
		},
		systemMessage: userMessage,
	};
}

export function lint(
	filePath: string,
	extraFlags: Array<string> = [],
	settings: LintSettings = DEFAULT_SETTINGS,
): HookOutput | undefined {
	if (!isLintableFile(filePath)) {
		return undefined;
	}

	if (shouldBustCache(settings.cacheBust)) {
		clearCache();
	} else {
		const importers = findImporters(filePath, settings.runner);
		invalidateCacheEntries(importers);
	}

	const outputs: Array<string> = [];

	if (settings.oxlint) {
		const output = runOxlint(filePath, extraFlags, settings.runner);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	if (settings.eslint) {
		const output = runEslint(filePath, extraFlags, settings.runner);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	if (settings.eslint) {
		restartDaemon(settings.runner);
	}

	if (outputs.length > 0) {
		const combined = outputs.join("\n");
		const errors = formatErrors(combined);
		if (errors.length > 0) {
			return buildHookOutput(filePath, errors);
		}
	}

	return undefined;
}

export function main(targets: Array<string>, settings: LintSettings = DEFAULT_SETTINGS): void {
	if (shouldBustCache(settings.cacheBust)) {
		clearCache();
	} else {
		const changedFiles = getChangedFiles();
		invalidateCacheEntries(changedFiles);
	}

	let hasErrors = false;
	for (const target of targets) {
		const outputs: Array<string> = [];

		if (settings.oxlint) {
			const output = runOxlint(target, ["--color"], settings.runner);
			if (output !== undefined) {
				outputs.push(output);
			}
		}

		if (settings.eslint) {
			const output = runEslint(target, ["--color"], settings.runner);
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
	}

	if (settings.eslint) {
		restartDaemon(settings.runner);
	}

	if (hasErrors) {
		process.exit(1);
	}
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

	try {
		const graph = getDependencyGraph(sourceRoot, entryPoints, runner);
		const targetRelative = relative(sourceRoot, absPath).replaceAll("\\", "/");
		return invertGraph(graph, targetRelative).map((file) => join(sourceRoot, file));
	} catch {
		return [];
	}
}

/* v8 ignore start -- CLI entrypoint */
const IS_CLI_INVOCATION = process.argv[1]?.endsWith("scripts/lint.ts") === true;
if (IS_CLI_INVOCATION) {
	const settings = readSettings();
	const targets = process.argv.length > 2 ? process.argv.slice(2) : ["."];
	main(targets, settings);
}
