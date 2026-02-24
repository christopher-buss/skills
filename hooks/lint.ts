import { createFromFile } from "file-entry-cache";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

import { lint } from "../scripts/lint.ts";

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
if (!isHookInput(input)) {
	process.exit(0);
}

const result = lint(input.tool_input.file_path, {
	createCache: createFromFile,
	execSync(command: string, options?: object): string {
		return execSync(command, { encoding: "utf-8", ...options });
	},
	existsSync,
	spawn,
});

if (result !== undefined) {
	console.error(result.systemMessage);
	// eslint-disable-next-line no-console -- Hook protocol requires stdout JSON
	console.log(JSON.stringify(result));
}
