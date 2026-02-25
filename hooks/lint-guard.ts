import type { PreToolUseInput } from "@constellos/claude-code-kit/types/hooks";

import { basename } from "node:path";

import { isProtectedFile } from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const input = await readStdinJson<PreToolUseInput>();

if (input.tool_name === "Write" || input.tool_name === "Edit") {
	const fileName = basename(input.tool_input.file_path);
	if (isProtectedFile(fileName)) {
		writeStdoutJson({
			decision: "block",
			reason: "Modifying linter config is forbidden. Report to user if a rule blocks your task.",
		});
	}
}
