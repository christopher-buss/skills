import { m as isProtectedFile } from "../lint-BZbpmXUG.mjs";
import { n as writeStdoutJson, t as readStdinJson } from "../io-BwovH54h.mjs";
import { basename } from "node:path";

//#region hooks/lint-guard.ts
const input = await readStdinJson();
if (input.tool_name === "Write" || input.tool_name === "Edit") {
	if (isProtectedFile(basename(input.tool_input.file_path))) writeStdoutJson({
		decision: "block",
		reason: "Modifying linter config is forbidden. Report to user if a rule blocks your task."
	});
}

//#endregion
export {  };