import type { PostToolUseHookOutput } from "@constellos/claude-code-kit/types/hooks";

import type { Buffer } from "node:buffer";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const TYPE_CHECK_EXTENSIONS = [".ts", ".tsx"];
const DEFAULT_RUNNER = "pnpm exec";

export function isTypeCheckable(filePath: string): boolean {
	return TYPE_CHECK_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

export function findTsconfigForFile(targetFile: string, projectRoot: string): string | undefined {
	let directory = dirname(targetFile);

	while (directory.length >= projectRoot.length) {
		const candidate = join(directory, "tsconfig.json");
		if (existsSync(candidate)) {
			return candidate;
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

export function formatTypeErrors(output: string): Array<string> {
	return output
		.split("\n")
		.filter((line) => /error TS/i.test(line))
		.slice(0, MAX_ERRORS);
}

export function buildTypeCheckOutput(
	errorCount: number,
	errors: Array<string>,
	truncated: boolean,
): PostToolUseHookOutput {
	const errorText = errors.join("\n");
	const userMessage = `TypeScript found ${errorCount} type error(s):\n${errorText}${truncated ? "\n..." : ""}`;
	const claudeMessage = `TypeScript found ${errorCount} type error(s):\n${errorText}${truncated ? "\n(run typecheck to view more)" : ""}`;

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
	const tsconfig = findTsconfigForFile(filePath, projectRoot);
	if (tsconfig === undefined) {
		return undefined;
	}

	const output = runTypeCheck(tsconfig, settings.runner);
	if (output === undefined) {
		return undefined;
	}

	const allErrors = output.split("\n").filter((line) => /error TS/i.test(line));
	const errors = formatTypeErrors(output);
	if (errors.length === 0) {
		return undefined;
	}

	return buildTypeCheckOutput(allErrors.length, errors, allErrors.length > MAX_ERRORS);
}
