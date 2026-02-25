import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { isProtectedFile } from "../scripts/lint.ts";

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

const input: unknown = JSON.parse(readFileSync(0, "utf-8"));
if (isHookInput(input)) {
	const filename = basename(input.tool_input.file_path);
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
