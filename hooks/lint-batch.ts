import type { PostToolBatchHookInput } from "@anthropic-ai/claude-agent-sdk";

import { existsSync } from "node:fs";
import process from "node:process";

import {
	getBucketKey,
	isLintableFile,
	lint,
	readEditedFiles,
	readSettings,
} from "../scripts/lint.ts";
import { readStdinJson } from "./io.ts";

const settings = readSettings();

if (!settings.lint) {
	process.exit(0);
}

if (settings.lintCadence === "strict") {
	process.exit(0);
}

if (!settings.lintAutoFixOnBatch) {
	process.exit(0);
}

const input = await readStdinJson<PostToolBatchHookInput>();
const BUCKET_KEY = getBucketKey(input);

const editedFiles = readEditedFiles(BUCKET_KEY);
if (editedFiles.length === 0) {
	process.exit(0);
}

const lintableFiles = editedFiles.filter((file) => existsSync(file) && isLintableFile(file));
if (lintableFiles.length === 0) {
	process.exit(0);
}

for (const file of lintableFiles) {
	lint(file, ["--fix"], settings, { restart: false });
}
