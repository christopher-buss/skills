import process from "node:process";

import {
	getChangedFiles,
	isLintableFile,
	lint,
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

// Consume stdin (Stop hook protocol requires it)
await readStdinJson();

const files = getChangedFiles().filter((file) => isLintableFile(file));
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
