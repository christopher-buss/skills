import type { PostToolUseHookOutput } from "@constellos/claude-code-kit/types/hooks";

import { createFilesMatcher, parseTsconfig } from "get-tsconfig";
import type { Buffer } from "node:buffer";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const TYPE_CHECK_EXTENSIONS = [".ts", ".tsx"];
const CACHE_PATH = join(".claude", "state", "tsconfig-cache.json");

export interface TsconfigCache {
	hashes: Record<string, string>;
	mappings: Record<string, string>;
	projectRoot: string;
}

export function readTsconfigCache(projectRoot: string): TsconfigCache | undefined {
	const cachePath = join(projectRoot, CACHE_PATH);
	if (!existsSync(cachePath)) {
		return undefined;
	}

	const content = readFileSync(cachePath, "utf-8");
	return JSON.parse(content) as unknown as TsconfigCache;
}

export function writeTsconfigCache(projectRoot: string, cache: TsconfigCache): void {
	const stateDirectory = join(projectRoot, ".claude", "state");
	mkdirSync(stateDirectory, { recursive: true });
	writeFileSync(join(projectRoot, CACHE_PATH), JSON.stringify(cache));
}

export function resolveTsconfig(filePath: string, projectRoot: string): string | undefined {
	const cache = readTsconfigCache(projectRoot);

	if (cache?.projectRoot === projectRoot) {
		const cachedTsconfig = cache.mappings[filePath];
		if (cachedTsconfig !== undefined && existsSync(cachedTsconfig)) {
			const currentHash = hashFileContent(cachedTsconfig);
			if (currentHash === cache.hashes[cachedTsconfig]) {
				return cachedTsconfig;
			}
		}
	}

	const tsconfig = findTsconfigForFile(filePath, projectRoot);
	if (tsconfig !== undefined) {
		const hash = hashFileContent(tsconfig);
		const updatedCache = {
			hashes: { ...cache?.hashes, [tsconfig]: hash },
			mappings: { ...cache?.mappings, [filePath]: tsconfig },
			projectRoot,
		} satisfies TsconfigCache;
		writeTsconfigCache(projectRoot, updatedCache);
	}

	return tsconfig;
}

function hashFileContent(filePath: string): string {
	const content = readFileSync(filePath, "utf-8");
	return createHash("sha256").update(content).digest("hex");
}

const DEFAULT_RUNNER = "pnpm exec";

export function isTypeCheckable(filePath: string): boolean {
	return TYPE_CHECK_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

export function resolveViaReferences(
	directory: string,
	configPath: string,
	targetFile: string,
): string | undefined {
	const config = parseTsconfig(configPath);
	const { references } = config;
	if (references === undefined || references.length === 0) {
		return undefined;
	}

	for (const ref of references) {
		const refPath = join(directory, ref.path);
		const refConfigPath = refPath.endsWith(".json") ? refPath : join(refPath, "tsconfig.json");
		if (!existsSync(refConfigPath)) {
			continue;
		}

		const refConfig = parseTsconfig(refConfigPath);
		const matcher = createFilesMatcher({ config: refConfig, path: refConfigPath });
		if (matcher(targetFile) !== undefined) {
			return refConfigPath;
		}
	}

	return undefined;
}

export function findTsconfigForFile(targetFile: string, projectRoot: string): string | undefined {
	let directory = dirname(targetFile);

	while (directory.length >= projectRoot.length) {
		const candidate = join(directory, "tsconfig.json");
		if (existsSync(candidate)) {
			return resolveViaReferences(directory, candidate, targetFile) ?? candidate;
		}

		const parent = dirname(directory);
		if (parent === directory) {
			break;
		}

		directory = parent;
	}

	return undefined;
}

export function runTypeCheck(tsconfig: string, runner = DEFAULT_RUNNER): string | undefined {
	try {
		execSync(`${runner} tsgo -p "${tsconfig}" --noEmit --pretty false`, {
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

const MAX_ERRORS = 5;

export interface TypeCheckSettings {
	runner: string;
	typecheck: boolean;
}

interface TypeCheckOutputOptions {
	dependencyErrors: Array<string>;
	fileErrors: Array<string>;
	truncated: boolean;
}

export function partitionErrors(
	errors: Array<string>,
	filePath: string,
	projectRoot: string,
): { dependencyErrors: Array<string>; fileErrors: Array<string> } {
	const relativePath = relative(projectRoot, filePath).replaceAll("\\", "/");
	const fileErrors: Array<string> = [];
	const dependencyErrors: Array<string> = [];

	for (const error of errors) {
		if (error.startsWith(relativePath)) {
			fileErrors.push(error);
		} else {
			dependencyErrors.push(error);
		}
	}

	return { dependencyErrors, fileErrors };
}

export function buildTypeCheckOutput(options: TypeCheckOutputOptions): PostToolUseHookOutput {
	const sections: Array<string> = [];

	if (options.fileErrors.length > 0) {
		const text = options.fileErrors.join("\n");
		sections.push(
			`TypeScript found ${options.fileErrors.length} type error(s) in edited file:\n${text}`,
		);
	}

	if (options.dependencyErrors.length > 0) {
		const text = options.dependencyErrors.join("\n");
		sections.push(
			`TypeScript found ${options.dependencyErrors.length} pre-existing type error(s) in dependencies:\n${text}`,
		);
	}

	const suffix = options.truncated ? "\n..." : "";
	const claudeSuffix = options.truncated ? "\n(run typecheck to view more)" : "";
	const userMessage = sections.join("\n\n") + suffix;
	const claudeMessage = sections.join("\n\n") + claudeSuffix;

	return {
		decision: undefined,
		hookSpecificOutput: {
			additionalContext: claudeMessage,
			hookEventName: "PostToolUse",
		},
		systemMessage: userMessage,
	};
}

export function typeCheck(
	filePath: string,
	settings: TypeCheckSettings,
): PostToolUseHookOutput | undefined {
	if (!isTypeCheckable(filePath)) {
		return undefined;
	}

	const projectRoot = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
	const tsconfig = resolveTsconfig(filePath, projectRoot);
	if (tsconfig === undefined) {
		return undefined;
	}

	const output = runTypeCheck(tsconfig, settings.runner);
	if (output === undefined) {
		return undefined;
	}

	const allErrors = output.split("\n").filter((line) => /error TS/i.test(line));
	if (allErrors.length === 0) {
		return undefined;
	}

	const isTruncated = allErrors.length > MAX_ERRORS;
	const capped = allErrors.slice(0, MAX_ERRORS);
	const { dependencyErrors, fileErrors } = partitionErrors(capped, filePath, projectRoot);

	return buildTypeCheckOutput({ dependencyErrors, fileErrors, truncated: isTruncated });
}
