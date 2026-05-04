import type { PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

import process from "node:process";

import {
	clearLintAttempt,
	getBucketKey,
	incrementLintAttempt,
	isInProject,
	narrowToolInput,
	readSettings,
	writeEditedFile,
} from "../scripts/lint.ts";
import { typeCheck } from "../scripts/type-check.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const settings = readSettings();

if (!settings.typecheck) {
	process.exit(0);
}

const input = await readStdinJson<PostToolUseHookInput>();

if (input.tool_name !== "Write" && input.tool_name !== "Edit") {
	process.exit(0);
}

const FILE_PATH = narrowToolInput(input).file_path;

function run(filePath: string): void {
	const result = typeCheck(filePath, settings);

	if (result !== undefined) {
		const count = incrementLintAttempt(input.session_id, filePath);

		if (count >= settings.maxLintAttempts && result.hookSpecificOutput) {
			result.hookSpecificOutput.additionalContext = `CRITICAL: ${filePath} failed type-check ${count} times. If you're stuck in a loop, STOP editing this file and report type errors to user for assistance.\n${result.hookSpecificOutput.additionalContext}`;
		}

		writeStdoutJson(result);
	} else {
		clearLintAttempt(input.session_id, filePath);
	}
}

if (isInProject(FILE_PATH)) {
	run(FILE_PATH);
	writeEditedFile(getBucketKey(input), FILE_PATH);
}
