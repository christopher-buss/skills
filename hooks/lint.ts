import type { PostToolUseInput } from "@constellos/claude-code-kit/types/hooks";

import process from "node:process";

import { lint, readLintAttempts, readSettings, writeLintAttempts } from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const settings = readSettings();

if (!settings.lint) {
	process.exit(0);
}

const input = await readStdinJson<PostToolUseInput>();

if (input.tool_name !== "Write" && input.tool_name !== "Edit") {
	process.exit(0);
}

function run(filePath: string): void {
	const attempts = readLintAttempts();
	const result = lint(filePath, ["--fix"], settings);

	if (result !== undefined) {
		const count = (attempts[filePath] ?? 0) + 1;
		attempts[filePath] = count;
		writeLintAttempts(attempts);

		if (count >= settings.maxLintAttempts && result.hookSpecificOutput) {
			result.hookSpecificOutput.additionalContext = `CRITICAL: ${filePath} failed linting ${count} times. STOP editing this file and report lint errors to user.\n${result.hookSpecificOutput.additionalContext}`;
		}

		writeStdoutJson(result);
	} else if (filePath in attempts) {
		delete attempts[filePath];
		writeLintAttempts(attempts);
	}
}

run(input.tool_input.file_path);
