import type { StopInput } from "@constellos/claude-code-kit/types/hooks";

import { resolve } from "node:path";
import process from "node:process";

import {
	findSourceRoot,
	getTransitiveDependents,
	isLintableFile,
	lint,
	readEditedFiles,
	readLintAttempts,
	readSettings,
	readStopAttempts,
	stopDecision,
	writeStopAttempts,
} from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const settings = readSettings();

if (!settings.lint) {
	process.exit(0);
}

const input = await readStdinJson<StopInput>();
const SESSION_ID = input.session_id;

const editedFiles = readEditedFiles(SESSION_ID);
if (editedFiles.length === 0) {
	process.exit(0);
}

const dependents = new Set<string>();
const seen = new Set<string>();
for (const file of editedFiles) {
	const absPath = resolve(file);
	const sourceRoot = findSourceRoot(absPath);
	if (sourceRoot === undefined || seen.has(sourceRoot)) {
		continue;
	}

	seen.add(sourceRoot);
	for (const dependent of getTransitiveDependents(editedFiles, sourceRoot, settings.runner)) {
		dependents.add(dependent);
	}
}

const files = [...new Set([...editedFiles, ...dependents])].filter((file) => isLintableFile(file));
if (files.length === 0) {
	process.exit(0);
}

const errorFiles: Array<string> = [];
for (const file of files) {
	const result = lint(file, ["--fix"], settings);
	if (result !== undefined) {
		errorFiles.push(file);
	}
}

const result = stopDecision({
	errorFiles,
	lintAttempts: readLintAttempts(),
	maxLintAttempts: settings.maxLintAttempts,
	stopAttempts: readStopAttempts(),
});

if (result === undefined) {
	process.exit(0);
}

if (result.resetStopAttempts) {
	writeStopAttempts(0);
	process.exit(0);
}

writeStopAttempts(readStopAttempts() + 1);

writeStdoutJson(result);
