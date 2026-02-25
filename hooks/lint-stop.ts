import { readFileSync } from "node:fs";
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

const settings = readSettings();

if (!settings.lint) {
	process.exit(0);
}

// Consume stdin (Stop hook protocol requires it)
readFileSync(0, "utf-8");

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

if (result !== undefined) {
	const stopCount = readStopAttempts() + 1;
	writeStopAttempts(stopCount);

	// eslint-disable-next-line no-console -- Hook protocol requires stdout JSON
	console.log(JSON.stringify(result));
}
