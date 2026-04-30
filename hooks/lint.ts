import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

import process from "node:process";

import {
	isInProject,
	lint,
	readLintAttempts,
	readSettings,
	writeEditedFile,
	writeLintAttempts,
} from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const settings = readSettings();

if (!settings.lint) {
	process.exit(0);
}

const input = await readStdinJson<PostToolUseHookInput>();

if (input.tool_name !== "Write" && input.tool_name !== "Edit") {
	process.exit(0);
}

// eslint-disable-next-line ts/no-non-null-assertion -- Edit/Write tool_input always has file_path
const FILE_PATH = (input.tool_input as Record<string, string>)["file_path"]!;

function run(filePath: string): void {
	const attempts = readLintAttempts();
	const result = lint(filePath, ["--fix"], settings);

	if (result !== undefined) {
		const count = (attempts[filePath] ?? 0) + 1;
		attempts[filePath] = count;
		writeLintAttempts(attempts);

		if (count >= settings.maxLintAttempts && result.hookSpecificOutput) {
			const loopNotice = `<workspace_diagnostics source="lint-loop">\n${filePath} has surfaced lint issues ${count} times. The fix loop appears stuck — surface the remaining diagnostics to the user instead of editing further?\n</workspace_diagnostics>`;
			result.hookSpecificOutput.additionalContext = `${loopNotice}\n${result.hookSpecificOutput.additionalContext}`;
		}

		writeStdoutJson(result);
	} else if (filePath in attempts) {
		delete attempts[filePath];
		writeLintAttempts(attempts);
	}
}

if (isInProject(FILE_PATH)) {
	run(FILE_PATH);
	writeEditedFile(input.session_id, FILE_PATH);
}
