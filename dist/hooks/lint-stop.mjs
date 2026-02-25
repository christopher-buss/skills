import { D as writeStopAttempts, T as stopDecision, _ as readLintAttempts, h as lint, l as getChangedFiles, p as isLintableFile, v as readSettings, y as readStopAttempts } from "../lint-BZbpmXUG.mjs";
import { n as writeStdoutJson, t as readStdinJson } from "../io-BwovH54h.mjs";
import process from "node:process";

//#region hooks/lint-stop.ts
const settings = readSettings();
if (!settings.lint) process.exit(0);
await readStdinJson();
const files = getChangedFiles().filter((file) => isLintableFile(file));
if (files.length === 0) process.exit(0);
const errorFiles = [];
for (const file of files) if (lint(file, ["--fix"], settings) !== void 0) errorFiles.push(file);
const result = stopDecision({
	errorFiles,
	lintAttempts: readLintAttempts(),
	maxLintAttempts: settings.maxLintAttempts,
	stopAttempts: readStopAttempts()
});
if (result === void 0) process.exit(0);
if (result.resetStopAttempts) {
	writeStopAttempts(0);
	process.exit(0);
}
writeStopAttempts(readStopAttempts() + 1);
writeStdoutJson(result);

//#endregion
export {  };