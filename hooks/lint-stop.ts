import type { StopHookInput } from "@anthropic-ai/claude-agent-sdk";

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import {
	findSourceRoot,
	getBucketKey,
	getTransitiveDependents,
	isLintableFile,
	lint,
	markBucketSurfaced,
	readEditedFiles,
	readLintAttempts,
	readSettings,
	readStopAttempts,
	restartDaemon,
	stopDecision,
	writeStopAttempts,
} from "../scripts/lint.ts";
import { readStdinJson, writeStdoutJson } from "./io.ts";

const debugLog: Array<string> = [];
const settings = readSettings();

function debug(message: string): void {
	if (settings.debug) {
		debugLog.push(message);
	}
}

if (!settings.lint) {
	process.exit(0);
}

const input = await readStdinJson<StopHookInput>();
const BUCKET_KEY = getBucketKey(input);

const editedFiles = readEditedFiles(BUCKET_KEY);
debug(`editedFiles=${JSON.stringify(editedFiles)}`);
if (editedFiles.length === 0) {
	process.exit(0);
}

const candidates: Array<string> = [...editedFiles];
if (settings.lintCadence === "strict") {
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

	candidates.push(...dependents);
}

const files = [...new Set(candidates)].filter((file) => existsSync(file) && isLintableFile(file));
debug(`lintable files: ${JSON.stringify(files)}`);
if (files.length === 0) {
	process.exit(0);
}

const errorFiles: Array<string> = [];
for (const file of files) {
	debug(`linting: ${file}`);
	const lintResult = lint(file, ["--fix"], settings, { restart: false });
	debug(`result: ${lintResult === undefined ? "ok" : "errors"}`);
	if (lintResult !== undefined) {
		errorFiles.push(file);
	}
}

debug(`errorFiles: ${JSON.stringify(errorFiles)}`);

debug("restartDaemon: start");
restartDaemon(settings.runner);
debug("restartDaemon: end");

const result = stopDecision({
	errorFiles,
	lintAttempts: readLintAttempts(),
	maxLintAttempts: settings.maxLintAttempts,
	stopAttempts: readStopAttempts(),
});

debug(`stopDecision: ${JSON.stringify(result)}`);

if (result === undefined) {
	if (debugLog.length > 0) {
		writeStdoutJson({ reason: `[lint-stop debug]\n${debugLog.join("\n")}` });
	}

	process.exit(0);
}

if (result.resetStopAttempts) {
	writeStopAttempts(0);
	process.exit(0);
}

writeStopAttempts(readStopAttempts() + 1);

if (debugLog.length > 0) {
	result.reason = `${result.reason ?? ""}\n\n[lint-stop debug]\n${debugLog.join("\n")}`;
}

writeStdoutJson(result);
markBucketSurfaced(BUCKET_KEY);
