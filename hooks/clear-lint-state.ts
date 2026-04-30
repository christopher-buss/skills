import type { SessionStartHookInput } from "@anthropic-ai/claude-agent-sdk";

import {
	clearAllBuckets,
	clearLintAttempts,
	clearStaleBuckets,
	clearStopAttempts,
} from "../scripts/lint.ts";
import { clearTypecheckStopAttempts } from "../scripts/type-check.ts";
import { readStdinJson } from "./io.ts";

const input = await readStdinJson<SessionStartHookInput>();

clearLintAttempts();
clearStopAttempts();
clearTypecheckStopAttempts();

// On `startup`, the session_id is freshly minted; nothing from any prior
// session is valid, so wipe every bucket. On `resume`/`clear`/`compact`, the
// session persists (subagents may still hold valid edits mid-task), so keep
// only buckets prefixed with the current session_id and drop the rest.
if (input.source === "startup") {
	clearAllBuckets();
} else {
	clearStaleBuckets(input.session_id);
}
