import { readFileSync } from "node:fs";
import { basename } from "node:path";
import process from "node:process";

import {
	isProtectedFile,
	lint,
	readLintAttempts,
	readSettings,
	writeLintAttempts,
} from "../scripts/lint.ts";

interface HookInput {
	// eslint-disable-next-line flawless/naming-convention -- Upstream-defined input shape
	tool_input: {
		// eslint-disable-next-line flawless/naming-convention -- Upstream-defined input shape
		file_path: string;
	};
}

function isHookInput(value: unknown): value is HookInput {
	if (typeof value !== "object" || value === null || !("tool_input" in value)) {
		return false;
	}

	// eslint-disable-next-line flawless/naming-convention -- Upstream-defined input shape
	const { tool_input } = value as { tool_input: unknown };
	return typeof tool_input === "object" && tool_input !== null && "file_path" in tool_input;
}

if (process.argv.includes("--guard")) {
	const guardInput: unknown = JSON.parse(readFileSync(0, "utf-8"));
	if (isHookInput(guardInput)) {
		const filename = basename(guardInput.tool_input.file_path);
		if (isProtectedFile(filename)) {
			// eslint-disable-next-line no-console -- Hook protocol requires stdout JSON
			console.log(
				JSON.stringify({
					decision: "block",
					reason: "Modifying linter config is forbidden. Report to user if a rule blocks your task.",
				}),
			);
		}
	}

	process.exit(0);
}

const settings = readSettings();

if (!settings.lint) {
	process.exit(0);
}

const input: unknown = JSON.parse(readFileSync(0, "utf-8"));
if (!isHookInput(input)) {
	process.exit(0);
}

function run(filePath: string): void {
	const attempts = readLintAttempts();
	const result = lint(filePath, ["--fix"], settings);

	if (result !== undefined) {
		const count = (attempts[filePath] ?? 0) + 1;
		attempts[filePath] = count;
		writeLintAttempts(attempts);

		if (count >= settings.maxLintAttempts) {
			result.hookSpecificOutput.additionalContext = `CRITICAL: ${filePath} failed linting ${count} times. STOP editing this file and report lint errors to user.\n${result.hookSpecificOutput.additionalContext}`;
		}

		// eslint-disable-next-line no-console -- Hook protocol requires stdout JSON
		console.log(JSON.stringify(result));
	} else if (filePath in attempts) {
		delete attempts[filePath];
		writeLintAttempts(attempts);
	}
}

run(input.tool_input.file_path);
