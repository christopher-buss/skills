import type { SessionStartHookInput } from "@anthropic-ai/claude-agent-sdk";

import process from "node:process";

import {
	getClaudePid,
	loadLiveSessions,
	pruneDeadSessions,
	registerSession,
} from "../scripts/lint.ts";
import { readStdinJson } from "./io.ts";

const input = await readStdinJson<SessionStartHookInput>();
const PID = getClaudePid() ?? String(process.ppid);
registerSession(input.session_id, PID);
pruneDeadSessions(loadLiveSessions());
