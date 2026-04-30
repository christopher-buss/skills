import type { SessionStartHookInput } from "@anthropic-ai/claude-agent-sdk";

import { clearEditedFiles, clearLintAttempts, clearStopAttempts } from "../scripts/lint.ts";
import { clearTypecheckStopAttempts } from "../scripts/type-check.ts";
import { readStdinJson } from "./io.ts";

const input = await readStdinJson<SessionStartHookInput>();

clearLintAttempts();
clearStopAttempts();
clearTypecheckStopAttempts();
clearEditedFiles(input.session_id);
