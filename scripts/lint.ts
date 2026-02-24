// TODO: invalidate eslint_d cache when cspell.config.yaml changes
import { createFromFile } from "file-entry-cache";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";

export interface LintSettings {
	eslint: boolean;
	lint: boolean;
	oxlint: boolean;
}

export interface SettingsDeps {
	existsSync(path: string): boolean;
	readFileSync(path: string, encoding: BufferEncoding): string;
}

export interface LintDeps extends CacheDeps, ExecDeps, FileSystemDeps, SpawnDeps {}

export type DependencyGraph = Record<string, Array<string>>;

interface FileSystemDeps {
	existsSync(path: string): boolean;
}

interface CacheDeps {
	createCache(path: string): { reconcile(): void; removeEntry(key: string): void };
	existsSync(path: string): boolean;
}

interface ExecDeps {
	execSync(command: string, options?: object): string;
}

interface SpawnResult {
	on(event: string, handler: () => void): SpawnResult;
	unref(): void;
}

interface SpawnDeps {
	spawn(command: string, args: Array<string>, options?: object): SpawnResult;
}

interface HookOutput {
	hookSpecificOutput: {
		additionalContext: string;
		hookEventName: string;
	};
	systemMessage: string;
}

const ESLINT_CACHE_PATH = ".eslintcache";
const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts"];
const ENTRY_CANDIDATES = ["index.ts", "cli.ts", "main.ts"];
const MAX_ERRORS = 5;

const SETTINGS_FILE = ".claude/sentinel.local.md";

const DEFAULT_SETTINGS: LintSettings = { eslint: true, lint: true, oxlint: false };

export function readSettings(deps: SettingsDeps): LintSettings {
	if (!deps.existsSync(SETTINGS_FILE)) {
		return { ...DEFAULT_SETTINGS };
	}

	const content = deps.readFileSync(SETTINGS_FILE, "utf-8");
	const fields = parseFrontmatter(content);

	return {
		eslint: fields.get("eslint") !== "false",
		lint: fields.get("lint") !== "false",
		oxlint: fields.get("oxlint") === "true",
	};
}

export function getChangedFiles(deps: ExecDeps): Array<string> {
	const options = { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] };
	const changed = deps.execSync("git diff --name-only --diff-filter=d HEAD", options);
	const untracked = deps.execSync("git ls-files --others --exclude-standard", options);
	return [...changed.trim().split("\n"), ...untracked.trim().split("\n")].filter(Boolean);
}

export function isLintableFile(filePath: string, extensions = DEFAULT_EXTENSIONS): boolean {
	return extensions.some((extension) => filePath.endsWith(extension));
}

export function findEntryPoints(sourceRoot: string, deps: FileSystemDeps): Array<string> {
	return ENTRY_CANDIDATES.map((name) => join(sourceRoot, name)).filter((path) => {
		return deps.existsSync(path);
	});
}

export function getDependencyGraph(
	sourceRoot: string,
	entryPoints: Array<string>,
	deps: ExecDeps,
): DependencyGraph {
	const entryArguments = entryPoints.map((ep) => `"${ep}"`).join(" ");
	const output = deps.execSync(`pnpm madge --json ${entryArguments}`, {
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

export function findSourceRoot(filePath: string, deps: FileSystemDeps): string | undefined {
	let current = dirname(filePath);
	while (current !== dirname(current)) {
		if (deps.existsSync(join(current, "package.json"))) {
			const sourceDirectory = join(current, "src");
			if (deps.existsSync(sourceDirectory)) {
				return sourceDirectory;
			}

			return current;
		}

		current = dirname(current);
	}

	return undefined;
}

export function invalidateCacheEntries(filePaths: Array<string>, deps: CacheDeps): void {
	if (filePaths.length === 0) {
		return;
	}

	if (!deps.existsSync(ESLINT_CACHE_PATH)) {
		return;
	}

	const cache = deps.createCache(ESLINT_CACHE_PATH);
	for (const file of filePaths) {
		cache.removeEntry(file);
	}

	cache.reconcile();
}

export function runOxlint(
	filePath: string,
	deps: ExecDeps,
	extraFlags: Array<string> = [],
): string | undefined {
	const flags = extraFlags.length > 0 ? `${extraFlags.join(" ")} ` : "";
	try {
		deps.execSync(`pnpm exec oxlint ${flags}"${filePath}"`, {
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
	deps: ExecDeps,
	extraFlags: Array<string> = [],
): string | undefined {
	const flags = ["--cache", ...extraFlags].join(" ");
	try {
		deps.execSync(`pnpm exec eslint_d ${flags} "${filePath}"`, {
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

export function restartDaemon(deps: SpawnDeps): void {
	try {
		deps.spawn("pnpm", ["eslint_d", "restart"], {
			detached: true,
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
	deps: LintDeps,
	extraFlags: Array<string> = [],
	settings: LintSettings = DEFAULT_SETTINGS,
): HookOutput | undefined {
	if (!isLintableFile(filePath)) {
		return undefined;
	}

	const importers = findImporters(filePath, deps);
	invalidateCacheEntries(importers, deps);

	const outputs: Array<string> = [];

	if (settings.oxlint) {
		const output = runOxlint(filePath, deps, extraFlags);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	if (settings.eslint) {
		const output = runEslint(filePath, deps, extraFlags);
		if (output !== undefined) {
			outputs.push(output);
		}
	}

	if (settings.eslint) {
		restartDaemon(deps);
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

export function main(
	targets: Array<string>,
	deps: LintDeps,
	settings: LintSettings = DEFAULT_SETTINGS,
): void {
	const changedFiles = getChangedFiles(deps);
	invalidateCacheEntries(changedFiles, deps);

	let hasErrors = false;
	for (const target of targets) {
		const outputs: Array<string> = [];

		if (settings.oxlint) {
			const output = runOxlint(target, deps, ["--color"]);
			if (output !== undefined) {
				outputs.push(output);
			}
		}

		if (settings.eslint) {
			const output = runEslint(target, deps, ["--color"]);
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
		restartDaemon(deps);
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

function findImporters(filePath: string, deps: LintDeps): Array<string> {
	const absPath = resolve(filePath);
	const sourceRoot = findSourceRoot(absPath, deps);
	if (sourceRoot === undefined) {
		return [];
	}

	const entryPoints = findEntryPoints(sourceRoot, deps);
	if (entryPoints.length === 0) {
		return [];
	}

	try {
		const graph = getDependencyGraph(sourceRoot, entryPoints, deps);
		const targetRelative = relative(sourceRoot, absPath).replaceAll("\\", "/");
		return invertGraph(graph, targetRelative).map((file) => join(sourceRoot, file));
	} catch {
		return [];
	}
}

/* v8 ignore start -- CLI entrypoint */
const IS_CLI_INVOCATION = process.argv[1]?.endsWith("lint.ts") === true;
if (IS_CLI_INVOCATION) {
	const deps: LintDeps = {
		createCache: createFromFile,
		execSync(command: string, options?: object): string {
			return execSync(command, { encoding: "utf-8", ...options });
		},
		existsSync,
		spawn,
	};
	const settings = readSettings({ existsSync, readFileSync });
	const targets = process.argv.length > 2 ? process.argv.slice(2) : ["."];
	main(targets, deps, settings);
}
