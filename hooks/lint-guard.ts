import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";

import { basename } from "node:path";

import { isProtectedFile } from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const input = await readStdinJson<PreToolUseHookInput>();

if (input.tool_name === "Write" || input.tool_name === "Edit") {
	// eslint-disable-next-line ts/no-non-null-assertion -- Edit/Write tool_input always has file_path
	const filePath = (input.tool_input as Record<string, string>)["file_path"]!;
	const fileName = basename(filePath);
	if (isProtectedFile(fileName)) {
		writeStdoutJson({
			decision: "block",
			reason: "Modifying linter config is forbidden. Report to user if a rule blocks your task.",
		});
	}
}
