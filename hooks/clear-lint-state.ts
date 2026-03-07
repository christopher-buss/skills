import type { SessionStartInput } from "@constellos/claude-code-kit/types/hooks";

import { clearEditedFiles, clearLintAttempts, clearStopAttempts } from "../scripts/lint.ts";
import { clearTypecheckStopAttempts } from "../scripts/type-check.ts";
import { readStdinJson } from "./io.ts";

const input = await readStdinJson<SessionStartInput>();

clearLintAttempts();
clearStopAttempts();
clearTypecheckStopAttempts();
clearEditedFiles(input.session_id);
