import type { StopInput } from "@constellos/claude-code-kit/types/hooks";

import { isAbsolute, join, resolve } from "node:path";
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

const debugLog: Array<string> = [];
const settings = readSettings();

function debug(message: string): void {
	if (settings.debug) {
		debugLog.push(message);
	}
}

if (!settings.typecheck) {
	process.exit(0);
}

const input = await readStdinJson<StopInput>();
const SESSION_ID = input.session_id;

const PROJECT_ROOT = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();

const editedFiles = readEditedFiles(SESSION_ID);
debug(`editedFiles=${JSON.stringify(editedFiles)}`);
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
debug(`type-checkable files: ${JSON.stringify(files)}`);
if (files.length === 0) {
	process.exit(0);
}

const errorFiles: Array<string> = [];
for (const file of files) {
	const absolutePath = isAbsolute(file) ? file : join(PROJECT_ROOT, file);
	debug(`file=${file} isAbsolute=${String(isAbsolute(file))} absolutePath=${absolutePath}`);
	const tsconfig = resolveTsconfig(absolutePath, PROJECT_ROOT);
	debug(`tsconfig=${String(tsconfig)}`);
	if (tsconfig === undefined) {
		continue;
	}

	const output = runTypeCheck(tsconfig, settings.runner, settings.typecheckArgs);
	if (output !== undefined) {
		const hasErrors = /error TS/i.test(output);
		debug(`typecheck ${file}: ${hasErrors ? "errors" : "ok"}`);
		if (hasErrors) {
			errorFiles.push(file);
		}
	}
}

debug(`errorFiles: ${JSON.stringify(errorFiles)}`);

const result = typecheckStopDecision({
	errorFiles,
	lintAttempts: readLintAttempts(),
	maxLintAttempts: settings.maxLintAttempts,
	stopAttempts: readTypecheckStopAttempts(),
});

debug(`stopDecision: ${JSON.stringify(result)}`);

if (result === undefined) {
	if (debugLog.length > 0) {
		writeStdoutJson({ reason: `[type-check-stop debug]\n${debugLog.join("\n")}` });
	}

	process.exit(0);
}

if (result.resetStopAttempts) {
	writeTypecheckStopAttempts(0);
	process.exit(0);
}

writeTypecheckStopAttempts(readTypecheckStopAttempts() + 1);

if (debugLog.length > 0) {
	result.reason = `${result.reason ?? ""}\n\n[type-check-stop debug]\n${debugLog.join("\n")}`;
}

writeStdoutJson(result);
