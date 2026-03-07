import { O as stopDecision, S as readStopAttempts, _ as lint, b as readLintAttempts, c as findSourceRoot, f as getTransitiveDependents, h as isLintableFile, j as writeStopAttempts, x as readSettings, y as readEditedFiles } from "../lint.mjs";
import { n as writeStdoutJson, t as readStdinJson } from "../io.mjs";
import { resolve } from "node:path";
import process from "node:process";

//#region hooks/lint-stop.ts
const settings = readSettings();
if (!settings.lint) process.exit(0);
const SESSION_ID = (await readStdinJson()).session_id;
const editedFiles = readEditedFiles(SESSION_ID);
if (editedFiles.length === 0) process.exit(0);
const dependents = /* @__PURE__ */ new Set();
const seen = /* @__PURE__ */ new Set();
for (const file of editedFiles) {
	const sourceRoot = findSourceRoot(resolve(file));
	if (sourceRoot === void 0 || seen.has(sourceRoot)) continue;
	seen.add(sourceRoot);
	for (const dependent of getTransitiveDependents(editedFiles, sourceRoot, settings.runner)) dependents.add(dependent);
}
const files = [...new Set([...editedFiles, ...dependents])].filter((file) => isLintableFile(file));
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