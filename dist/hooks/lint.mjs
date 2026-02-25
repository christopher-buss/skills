import { E as writeLintAttempts, _ as readLintAttempts, h as lint, v as readSettings } from "../lint-BZbpmXUG.mjs";
import { n as writeStdoutJson, t as readStdinJson } from "../io-BwovH54h.mjs";
import process from "node:process";

//#region hooks/lint.ts
const settings = readSettings();
if (!settings.lint) process.exit(0);
const input = await readStdinJson();
if (input.tool_name !== "Write" && input.tool_name !== "Edit") process.exit(0);
function run(filePath) {
	const attempts = readLintAttempts();
	const result = lint(filePath, ["--fix"], settings);
	if (result !== void 0) {
		const count = (attempts[filePath] ?? 0) + 1;
		attempts[filePath] = count;
		writeLintAttempts(attempts);
		if (count >= settings.maxLintAttempts && result.hookSpecificOutput) result.hookSpecificOutput.additionalContext = `CRITICAL: ${filePath} failed linting ${count} times. STOP editing this file and report lint errors to user.\n${result.hookSpecificOutput.additionalContext}`;
		writeStdoutJson(result);
	} else if (filePath in attempts) {
		delete attempts[filePath];
		writeLintAttempts(attempts);
	}
}
run(input.tool_input.file_path);

//#endregion
export {  };