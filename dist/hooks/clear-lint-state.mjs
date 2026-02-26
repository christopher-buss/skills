import { a as clearStopAttempts, i as clearLintAttempts } from "../lint.mjs";
import { t as clearTypecheckStopAttempts } from "../type-check.mjs";

//#region hooks/clear-lint-state.ts
clearLintAttempts();
clearStopAttempts();
clearTypecheckStopAttempts();

//#endregion
export {  };