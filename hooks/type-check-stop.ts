import { join } from "node:path";
import process from "node:process";

import { getChangedFiles, readLintAttempts, readSettings } from "../scripts/lint.ts";
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

await readStdinJson();

const PROJECT_ROOT = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const files = getChangedFiles().filter((file) => isTypeCheckable(file));
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

	const output = runTypeCheck(tsconfig, settings.runner);
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
