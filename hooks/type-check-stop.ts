import type { StopInput } from "@constellos/claude-code-kit/types/hooks";

import { join, resolve } from "node:path";
import process from "node:process";

import {
	findSourceRoot,
	getTransitiveDependents,
	readEditedFiles,
	readLintAttempts,
	readSettings,
} from "../scripts/lint.ts";
import {
	isTypeCheckable,
	readTypecheckStopAttempts,
	resolveTsconfig,
	runTypeCheck,
	typecheckStopDecision,
	writeTypecheckStopAttempts,
} from "../scripts/type-check.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const settings = readSettings();

if (!settings.typecheck) {
	process.exit(0);
}

const input = await readStdinJson<StopInput>();
const SESSION_ID = input.session_id;

const PROJECT_ROOT = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

const editedFiles = readEditedFiles(SESSION_ID);
if (editedFiles.length === 0) {
	process.exit(0);
}

const allFiles = new Set(editedFiles);
const seenRoots = new Set<string>();
for (const file of editedFiles) {
	const absPath = resolve(file);
	const sourceRoot = findSourceRoot(absPath);
	if (sourceRoot === undefined || seenRoots.has(sourceRoot)) {
		continue;
	}

	seenRoots.add(sourceRoot);
	for (const dependent of getTransitiveDependents(editedFiles, sourceRoot, settings.runner)) {
		allFiles.add(dependent);
	}
}

const files = [...allFiles].filter((file) => isTypeCheckable(file));
if (files.length === 0) {
	process.exit(0);
}

const errorFiles: Array<string> = [];
for (const file of files) {
	const absolutePath = join(PROJECT_ROOT, file);
	const tsconfig = resolveTsconfig(absolutePath, PROJECT_ROOT);
	if (tsconfig === undefined) {
		continue;
	}

	const output = runTypeCheck(tsconfig, settings.runner, settings.typecheckArgs);
	if (output !== undefined) {
		const hasErrors = /error TS/i.test(output);
		if (hasErrors) {
			errorFiles.push(file);
		}
	}
}

const result = typecheckStopDecision({
	errorFiles,
	lintAttempts: readLintAttempts(),
	maxLintAttempts: settings.maxLintAttempts,
	stopAttempts: readTypecheckStopAttempts(),
});

if (result === undefined) {
	process.exit(0);
}

if (result.resetStopAttempts) {
	writeTypecheckStopAttempts(0);
	process.exit(0);
}

writeTypecheckStopAttempts(readTypecheckStopAttempts() + 1);

writeStdoutJson(result);
