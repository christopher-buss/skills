import type { TaskCompletedHookInput } from "@anthropic-ai/claude-agent-sdk";

import { existsSync } from "node:fs";
import process from "node:process";

import {
	getBucketKey,
	isLintableFile,
	lint,
	markBucketSurfaced,
	readEditedFiles,
	readSettings,
} from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const settings = readSettings();

if (!settings.lint) {
	process.exit(0);
}

if (settings.lintCadence !== "tiered") {
	process.exit(0);
}

const input = await readStdinJson<TaskCompletedHookInput>();
const BUCKET_KEY = getBucketKey(input);

const editedFiles = readEditedFiles(BUCKET_KEY);
if (editedFiles.length === 0) {
	process.exit(0);
}

const lintableFiles = editedFiles.filter((file) => existsSync(file) && isLintableFile(file));
if (lintableFiles.length === 0) {
	process.exit(0);
}

const errorFiles: Array<string> = [];
for (const file of lintableFiles) {
	const result = lint(file, ["--fix"], settings, { restart: false });
	if (result !== undefined) {
		errorFiles.push(file);
	}
}

markBucketSurfaced(BUCKET_KEY);

if (errorFiles.length === 0) {
	process.exit(0);
}

const FILE_LIST = errorFiles.join(", ");
const REASON = `<workspace_diagnostics source="eslint">\nLint issues remain in: ${FILE_LIST}. If related to recent changes, address before continuing?\n</workspace_diagnostics>`;
writeStdoutJson({ reason: REASON, systemMessage: REASON });
