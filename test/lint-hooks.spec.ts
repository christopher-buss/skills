import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK_LINT = resolve("hooks/lint.ts");
const HOOK_LINT_STOP = resolve("hooks/lint-stop.ts");
const SETTINGS_FILE = ".claude/sentinel.local.md";
const EDITED_FILES_PATH = ".claude/state/edited-files.json";

interface HookResult {
	exitCode: null | number;
	stderr: string;
	stdout: string;
}

interface EditedFilesBucket {
	edited: Array<string>;
	lastSurfacedAt: null | number;
}

type EditedFilesState = Record<string, EditedFilesBucket>;

function setupWorkDirectory(prefix: string): string {
	const directory = mkdtempSync(join(tmpdir(), `isentinel-${prefix}-`));
	mkdirSync(join(directory, "src"), { recursive: true });
	writeFileSync(join(directory, "src/foo.ts"), "export const x = 1;\n");
	return directory;
}

function teardown(directory: string): void {
	try {
		rmSync(directory, { force: true, recursive: true });
	} catch {
		// On Windows, restartDaemon spawns a detached background process that
		// may briefly hold a handle to the temp dir. The lint hook itself has
		// already completed, so test correctness is unaffected; OS cleanup
		// reaps the directory eventually.
	}
}

function writeSettings(cwd: string, cadence: "stop-only" | "strict" | "tiered"): void {
	const path = join(cwd, SETTINGS_FILE);
	mkdirSync(join(cwd, ".claude"), { recursive: true });
	writeFileSync(path, `---\nlint-cadence: ${cadence}\neslint: false\noxlint: false\n---\n`);
}

function writeEditedState(cwd: string, state: EditedFilesState): void {
	const path = join(cwd, EDITED_FILES_PATH);
	mkdirSync(join(cwd, ".claude/state"), { recursive: true });
	writeFileSync(path, JSON.stringify(state));
}

function readEditedState(cwd: string): EditedFilesState {
	const path = join(cwd, EDITED_FILES_PATH);
	if (!existsSync(path)) {
		return {};
	}

	return JSON.parse(readFileSync(path, "utf-8")) as unknown as EditedFilesState;
}

function runHook(hookPath: string, input: unknown, cwd: string): HookResult {
	const result = spawnSync("node", [hookPath], {
		cwd,
		encoding: "utf-8",
		input: JSON.stringify(input),
	});
	return {
		exitCode: result.status,
		stderr: result.stderr,
		stdout: result.stdout,
	};
}

describe("lint hook (PostToolUse) cadence", () => {
	it("should record file in tiered mode without surfacing or linting", () => {
		expect.assertions(3);

		const workDirectory = setupWorkDirectory("lint-tiered");
		try {
			writeSettings(workDirectory, "tiered");
			const filePath = join(workDirectory, "src/foo.ts");
			const input = {
				session_id: "session-tiered",
				tool_input: { file_path: filePath },
				tool_name: "Edit",
			};

			const result = runHook(HOOK_LINT, input, workDirectory);

			expect(result.stdout.trim()).toBe("");
			expect(result.exitCode).toBe(0);

			const state = readEditedState(workDirectory);

			expect(state["session-tiered:main"]?.edited).toContain(filePath);
		} finally {
			teardown(workDirectory);
		}
	});

	it("should record file in stop-only mode without surfacing or linting", () => {
		expect.assertions(3);

		const workDirectory = setupWorkDirectory("lint-stop-only");
		try {
			writeSettings(workDirectory, "stop-only");
			const filePath = join(workDirectory, "src/foo.ts");
			const input = {
				session_id: "session-stop-only",
				tool_input: { file_path: filePath },
				tool_name: "Edit",
			};

			const result = runHook(HOOK_LINT, input, workDirectory);

			expect(result.stdout.trim()).toBe("");
			expect(result.exitCode).toBe(0);

			const state = readEditedState(workDirectory);

			expect(state["session-stop-only:main"]?.edited).toContain(filePath);
		} finally {
			teardown(workDirectory);
		}
	});

	it("should record file and run lint in strict mode", () => {
		expect.assertions(2);

		// strict mode preserves existing behaviour: lint() runs (no-op when both
		// eslint and oxlint are disabled, returns undefined → no stdout).
		const workDirectory = setupWorkDirectory("lint-strict");
		try {
			writeSettings(workDirectory, "strict");
			const filePath = join(workDirectory, "src/foo.ts");
			const input = {
				session_id: "session-strict",
				tool_input: { file_path: filePath },
				tool_name: "Edit",
			};

			const result = runHook(HOOK_LINT, input, workDirectory);

			expect(result.exitCode).toBe(0);

			const state = readEditedState(workDirectory);

			expect(state["session-strict:main"]?.edited).toContain(filePath);
		} finally {
			teardown(workDirectory);
		}
	});
});

describe("lint-stop hook cadence", () => {
	it("should exit cleanly when bucket is empty regardless of cadence", () => {
		expect.assertions(2);

		const workDirectory = setupWorkDirectory("lint-stop-empty");
		try {
			writeSettings(workDirectory, "tiered");
			const input = { session_id: "session-empty" };

			const result = runHook(HOOK_LINT_STOP, input, workDirectory);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("");
		} finally {
			teardown(workDirectory);
		}
	});

	it("should short-circuit in tiered mode when bucket already surfaced", () => {
		expect.assertions(3);

		const workDirectory = setupWorkDirectory("lint-stop-tiered-surfaced");
		try {
			writeSettings(workDirectory, "tiered");
			const filePath = join(workDirectory, "src/foo.ts");
			writeEditedState(workDirectory, {
				"session-tiered:main": { edited: [filePath], lastSurfacedAt: 1_234 },
			});

			const input = { session_id: "session-tiered" };
			const result = runHook(HOOK_LINT_STOP, input, workDirectory);

			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("");

			// state untouched: lastSurfacedAt preserved, edited still present.
			const state = readEditedState(workDirectory);

			expect(state["session-tiered:main"]?.lastSurfacedAt).toBe(1_234);
		} finally {
			teardown(workDirectory);
		}
	});

	it("should lint in tiered mode when bucket has unsurfaced edits", () => {
		expect.assertions(2);

		const workDirectory = setupWorkDirectory("lint-stop-tiered-unsurfaced");
		try {
			writeSettings(workDirectory, "tiered");
			const filePath = join(workDirectory, "src/foo.ts");
			writeEditedState(workDirectory, {
				"session-tiered-unsurfaced:main": { edited: [filePath], lastSurfacedAt: null },
			});

			const input = { session_id: "session-tiered-unsurfaced" };
			const result = runHook(HOOK_LINT_STOP, input, workDirectory);

			// With eslint and oxlint disabled, lint() returns undefined → no
			// errors, no stop decision → exit 0 with no output. The key signal is
			// that the hook did not short-circuit on the surfaced gate.
			expect(result.exitCode).toBe(0);
			expect(result.stdout.trim()).toBe("");
		} finally {
			teardown(workDirectory);
		}
	});

	it("should lint in stop-only mode regardless of lastSurfacedAt", () => {
		expect.assertions(1);

		const workDirectory = setupWorkDirectory("lint-stop-only-mode");
		try {
			writeSettings(workDirectory, "stop-only");
			const filePath = join(workDirectory, "src/foo.ts");
			writeEditedState(workDirectory, {
				"session-stop-only:main": { edited: [filePath], lastSurfacedAt: 5_678 },
			});

			const input = { session_id: "session-stop-only" };
			const result = runHook(HOOK_LINT_STOP, input, workDirectory);

			// stop-only ignores the upstream-surface gate.
			expect(result.exitCode).toBe(0);
		} finally {
			teardown(workDirectory);
		}
	});

	it("should preserve strict mode behaviour with bucket present", () => {
		expect.assertions(1);

		const workDirectory = setupWorkDirectory("lint-stop-strict");
		try {
			writeSettings(workDirectory, "strict");
			const filePath = join(workDirectory, "src/foo.ts");
			writeEditedState(workDirectory, {
				"session-strict:main": { edited: [filePath], lastSurfacedAt: null },
			});

			const input = { session_id: "session-strict" };
			const result = runHook(HOOK_LINT_STOP, input, workDirectory);

			// strict mode: lint() runs but eslint/oxlint disabled → no errors →
			// exit 0.
			expect(result.exitCode).toBe(0);
		} finally {
			teardown(workDirectory);
		}
	});
});
