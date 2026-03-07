import { b as readLintAttempts, c as findSourceRoot, f as getTransitiveDependents, x as readSettings, y as readEditedFiles } from "../lint.mjs";
import { n as writeStdoutJson, t as readStdinJson } from "../io.mjs";
import { a as runTypeCheck, c as writeTypecheckStopAttempts, i as resolveTsconfig, n as isTypeCheckable, r as readTypecheckStopAttempts, s as typecheckStopDecision } from "../type-check.mjs";
import { join, resolve } from "node:path";
import process from "node:process";

//#region hooks/type-check-stop.ts
const settings = readSettings();
if (!settings.typecheck) process.exit(0);
const SESSION_ID = (await readStdinJson()).session_id;
const PROJECT_ROOT = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const editedFiles = readEditedFiles(SESSION_ID);
if (editedFiles.length === 0) process.exit(0);
const allFiles = new Set(editedFiles);
const seenRoots = /* @__PURE__ */ new Set();
for (const file of editedFiles) {
	const sourceRoot = findSourceRoot(resolve(file));
	if (sourceRoot === void 0 || seenRoots.has(sourceRoot)) continue;
	seenRoots.add(sourceRoot);
	for (const dependent of getTransitiveDependents(editedFiles, sourceRoot, settings.runner)) allFiles.add(dependent);
}
const files = [...allFiles].filter((file) => isTypeCheckable(file));
if (files.length === 0) process.exit(0);
const errorFiles = [];
for (const file of files) {
	const tsconfig = resolveTsconfig(join(PROJECT_ROOT, file), PROJECT_ROOT);
	if (tsconfig === void 0) continue;
	const output = runTypeCheck(tsconfig, settings.runner, settings.typecheckArgs);
	if (output !== void 0) {
		if (/error TS/i.test(output)) errorFiles.push(file);
	}
}
const result = typecheckStopDecision({
	errorFiles,
	lintAttempts: readLintAttempts(),
	maxLintAttempts: settings.maxLintAttempts,
	stopAttempts: readTypecheckStopAttempts()
});
if (result === void 0) process.exit(0);
if (result.resetStopAttempts) {
	writeTypecheckStopAttempts(0);
	process.exit(0);
}
writeTypecheckStopAttempts(readTypecheckStopAttempts() + 1);
writeStdoutJson(result);

//#endregion
export {  };