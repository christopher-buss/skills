import { a as clearLintAttempts, i as clearEditedFiles, o as clearStopAttempts } from "../lint.mjs";
import { t as readStdinJson } from "../io.mjs";
import { t as clearTypecheckStopAttempts } from "../type-check.mjs";

//#region hooks/clear-lint-state.ts
const input = await readStdinJson();
clearLintAttempts();
clearStopAttempts();
clearTypecheckStopAttempts();
clearEditedFiles(input.session_id);

//#endregion
export {  };