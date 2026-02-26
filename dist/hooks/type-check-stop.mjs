import { _ as readLintAttempts, l as getChangedFiles, v as readSettings } from "../lint.mjs";
import { n as writeStdoutJson, t as readStdinJson } from "../io.mjs";
import { a as runTypeCheck, c as writeTypecheckStopAttempts, i as resolveTsconfig, n as isTypeCheckable, r as readTypecheckStopAttempts, s as typecheckStopDecision } from "../type-check.mjs";
import { join } from "node:path";
import process from "node:process";

//#region hooks/type-check-stop.ts
const settings = readSettings();
if (!settings.typecheck) process.exit(0);
await readStdinJson();
const PROJECT_ROOT = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const files = getChangedFiles().filter((file) => isTypeCheckable(file));
if (files.length === 0) process.exit(0);
const errorFiles = [];
for (const file of files) {
	const tsconfig = resolveTsconfig(join(PROJECT_ROOT, file), PROJECT_ROOT);
	if (tsconfig === void 0) continue;
	const output = runTypeCheck(tsconfig, settings.runner);
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