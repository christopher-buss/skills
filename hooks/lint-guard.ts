import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

import { basename } from "node:path";

import { isGuardAllowed, isProtectedFile, narrowToolInput, readSettings } from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const input = await readStdinJson<PreToolUseHookInput>();

if (input.tool_name === "Write" || input.tool_name === "Edit") {
	const filePath = narrowToolInput(input).file_path;
	const fileName = basename(filePath);
	if (isProtectedFile(fileName) && !isGuardAllowed(filePath, readSettings().lintGuardAllow)) {
		writeStdoutJson({
			decision: "block",
			reason: "Modifying linter config is forbidden. Report to user if a rule blocks your task.",
		});
	}
}
