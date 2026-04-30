import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

type LintCadence = "stop-only" | "strict" | "tiered";

interface ScenarioOptions {
	cadence: LintCadence;
	editedFiles?: Array<string>;
	lastSurfacedAt?: null | number;
	lint?: boolean;
	lintAutoFixOnBatch?: boolean;
}

interface RunOptions {
	hook: string;
	scenario: ScenarioOptions;
	stdin: Record<string, unknown>;
}

interface RunResult {
	exitCode: null | number;
	stateAfter: Record<string, unknown> | undefined;
	stderr: string;
	stdout: string;
}

const REPO_ROOT = resolvePath(process.cwd());
const SESSION_ID = "session1";
const BUCKET_KEY = `${SESSION_ID}:main`;

const BASE_INPUT = {
	cwd: ".",
	session_id: SESSION_ID,
	transcript_path: "/tmp/t.json",
};

function buildSettingsContent(options: ScenarioOptions): string {
	return [
		"---",
		`lint: ${String(options.lint ?? true)}`,
		`lint-cadence: ${options.cadence}`,
		`lint-auto-fix-on-batch: ${String(options.lintAutoFixOnBatch ?? true)}`,
		"eslint: false",
		"oxlint: false",
		"---",
	].join("\n");
}

function setupSandbox(options: ScenarioOptions): string {
	const sandbox = mkdtempSync(join(tmpdir(), "cadence-hook-"));
	mkdirSync(join(sandbox, ".claude", "state"), { recursive: true });
	writeFileSync(join(sandbox, ".claude", "sentinel.local.md"), buildSettingsContent(options));
	if (options.editedFiles !== undefined) {
		const state = {
			[BUCKET_KEY]: {
				edited: options.editedFiles,
				lastSurfacedAt: options.lastSurfacedAt ?? null,
			},
		};
		writeFileSync(
			join(sandbox, ".claude", "state", "edited-files.json"),
			JSON.stringify(state),
		);
	}

	writeFileSync(join(sandbox, "package.json"), '{"name":"sandbox"}');
	return sandbox;
}

function readState(sandbox: string): Record<string, unknown> | undefined {
	try {
		const stateContent = readFileSync(
			join(sandbox, ".claude", "state", "edited-files.json"),
			"utf-8",
		);
		return JSON.parse(stateContent) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function runHook({ hook, scenario, stdin }: RunOptions): RunResult {
	const sandbox = setupSandbox(scenario);
	try {
		const hookPath = join(REPO_ROOT, "hooks", hook);
		const result = spawnSync("node", [hookPath], {
			cwd: sandbox,
			encoding: "utf-8",
			input: JSON.stringify(stdin),
		});

		return {
			exitCode: result.status,
			stateAfter: readState(sandbox),
			stderr: result.stderr,
			stdout: result.stdout,
		};
	} finally {
		rmSync(sandbox, { force: true, recursive: true });
	}
}

describe("lint-batch hook", () => {
	const hook = "lint-batch.ts";

	it("should short-circuit in strict cadence with no output", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "strict", editedFiles: ["src/foo.ts"] },
			stdin: { ...BASE_INPUT, hook_event_name: "PostToolBatch", tool_calls: [] },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should short-circuit when lintAutoFixOnBatch is false", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: {
				cadence: "tiered",
				editedFiles: ["src/foo.ts"],
				lintAutoFixOnBatch: false,
			},
			stdin: { ...BASE_INPUT, hook_event_name: "PostToolBatch", tool_calls: [] },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should produce no stdout in tiered cadence (suppress output)", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "tiered", editedFiles: [] },
			stdin: { ...BASE_INPUT, hook_event_name: "PostToolBatch", tool_calls: [] },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should run in stop-only cadence (does not short-circuit on cadence)", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "stop-only", editedFiles: [] },
			stdin: { ...BASE_INPUT, hook_event_name: "PostToolBatch", tool_calls: [] },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should exit cleanly when bucket is empty", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "tiered" },
			stdin: { ...BASE_INPUT, hook_event_name: "PostToolBatch", tool_calls: [] },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});
});

describe("lint-subagent-stop hook", () => {
	const hook = "lint-subagent-stop.ts";
	const stopInput = {
		...BASE_INPUT,
		agent_id: "main",
		agent_transcript_path: "/tmp/agent-t.json",
		agent_type: "general-purpose",
		hook_event_name: "SubagentStop",
		stop_hook_active: false,
	};

	it("should short-circuit in strict cadence", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "strict", editedFiles: ["src/foo.ts"] },
			stdin: stopInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should short-circuit in stop-only cadence", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "stop-only", editedFiles: ["src/foo.ts"] },
			stdin: stopInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should exit cleanly with empty bucket in tiered cadence", () => {
		expect.assertions(3);

		const result = runHook({
			hook,
			scenario: { cadence: "tiered" },
			stdin: stopInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stateAfter).toBeUndefined();
	});

	it("should not surface when bucket has only non-lintable entries", () => {
		expect.assertions(3);

		const result = runHook({
			hook,
			scenario: { cadence: "tiered", editedFiles: ["src/missing.ts"] },
			stdin: stopInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stateAfter).toMatchObject({
			[BUCKET_KEY]: { lastSurfacedAt: null },
		});
	});
});

describe("lint-task-completed hook", () => {
	const hook = "lint-task-completed.ts";
	const taskInput = {
		...BASE_INPUT,
		hook_event_name: "TaskCompleted",
		task_id: "task-1",
		task_subject: "test task",
	};

	it("should short-circuit in strict cadence", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "strict", editedFiles: ["src/foo.ts"] },
			stdin: taskInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should short-circuit in stop-only cadence", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "stop-only", editedFiles: ["src/foo.ts"] },
			stdin: taskInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should exit cleanly with empty bucket in tiered cadence", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "tiered" },
			stdin: taskInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("should short-circuit when lint disabled regardless of cadence", () => {
		expect.assertions(2);

		const result = runHook({
			hook,
			scenario: { cadence: "tiered", editedFiles: ["src/foo.ts"], lint: false },
			stdin: taskInput,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});
});
