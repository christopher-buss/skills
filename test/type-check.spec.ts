import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PartialDeep } from "type-fest";
import { describe, expect, it, vi } from "vitest";

import {
	buildTypeCheckOutput,
	findTsconfigForFile,
	formatTypeErrors,
	isTypeCheckable,
	runTypeCheck,
	typeCheck,
} from "../scripts/type-check.js";

function fromPartial<T>(mock: PartialDeep<NoInfer<T>>): T {
	return mock as T;
}

vi.mock(import("node:child_process"), async () => {
	return fromPartial({
		execSync: vi.fn<typeof execSync>(),
	});
});

const mockedExecSync = vi.mocked(execSync);

vi.mock(import("node:fs"), async () => {
	return {
		existsSync: vi.fn<typeof existsSync>(() => false),
	};
});

const mockedExistsSync = vi.mocked(existsSync);

describe(typeCheck, () => {
	it("should return undefined for non-ts files", () => {
		expect.assertions(1);

		expect(typeCheck("src/foo.js", { runner: "pnpm exec", typecheck: true })).toBeUndefined();
	});

	it("should return hook output when tsgo reports type errors", () => {
		expect.assertions(2);

		vi.stubEnv("CLAUDE_PROJECT_DIR", join("/project"));
		const tsconfig = join("/project", "tsconfig.json");
		mockedExistsSync.mockImplementation((path) => path === tsconfig);

		const errorOutput = "src/foo.ts(1,1): error TS2322: Type mismatch";
		mockedExecSync.mockImplementation(() => {
			const error = new Error("Command failed") as Error & { stdout: Buffer };
			error.stdout = Buffer.from(errorOutput);
			throw error;
		});

		const result = typeCheck(join("/project", "src", "foo.ts"), {
			runner: "pnpm exec",
			typecheck: true,
		});

		expect(result).toBeDefined();
		expect(result?.systemMessage).toContain("1 type error(s)");
	});
});

describe(findTsconfigForFile, () => {
	it("should return undefined when no tsconfig.json exists", () => {
		expect.assertions(1);

		mockedExistsSync.mockReturnValue(false);

		expect(
			findTsconfigForFile(join("/project", "src", "foo.ts"), join("/project")),
		).toBeUndefined();
	});

	it("should walk up to parent directory to find tsconfig.json", () => {
		expect.assertions(1);

		const expected = join("/project", "tsconfig.json");
		mockedExistsSync.mockImplementation((path) => path === expected);

		expect(
			findTsconfigForFile(join("/project", "src", "deep", "foo.ts"), join("/project")),
		).toBe(expected);
	});

	it("should find tsconfig.json in the same directory as the file", () => {
		expect.assertions(1);

		const expected = join("/project", "src", "tsconfig.json");
		mockedExistsSync.mockImplementation((path) => path === expected);

		expect(findTsconfigForFile(join("/project", "src", "foo.ts"), join("/project"))).toBe(
			expected,
		);
	});
});

describe(runTypeCheck, () => {
	it("should return undefined when typecheck succeeds", () => {
		expect.assertions(1);

		mockedExecSync.mockReturnValue("");

		expect(runTypeCheck("/project/tsconfig.json")).toBeUndefined();
	});

	it("should return stdout on type error", () => {
		expect.assertions(1);

		const errorOutput = "src/foo.ts(1,1): error TS2322: Type 'string' is not assignable";
		mockedExecSync.mockImplementation(() => {
			const error = new Error("Command failed") as Error & { stdout: Buffer };
			error.stdout = Buffer.from(errorOutput);
			throw error;
		});

		expect(runTypeCheck("/project/tsconfig.json")).toBe(errorOutput);
	});
});

describe(formatTypeErrors, () => {
	it("should filter lines containing error TS and cap at 5", () => {
		expect.assertions(1);

		const lines = [
			"src/a.ts(1,1): error TS2322: Type mismatch",
			"some other output",
			"src/b.ts(2,1): error TS2345: Argument mismatch",
		];

		expect(formatTypeErrors(lines.join("\n"))).toStrictEqual([
			"src/a.ts(1,1): error TS2322: Type mismatch",
			"src/b.ts(2,1): error TS2345: Argument mismatch",
		]);
	});
});

describe(buildTypeCheckOutput, () => {
	it("should return PostToolUseHookOutput with error details", () => {
		expect.assertions(3);

		const errors = ["src/foo.ts(1,1): error TS2322: Type mismatch"];
		const result = buildTypeCheckOutput(1, errors, false);

		expect(result.decision).toBeUndefined();
		expect(result.systemMessage).toContain("1 type error(s)");
		expect(result.hookSpecificOutput?.additionalContext).toContain("error TS2322");
	});
});

describe(isTypeCheckable, () => {
	it("should return true for .ts files", () => {
		expect.assertions(1);
		expect(isTypeCheckable("src/foo.ts")).toBe(true);
	});

	it("should return true for .tsx files", () => {
		expect.assertions(1);
		expect(isTypeCheckable("src/component.tsx")).toBe(true);
	});

	it("should return false for .js files", () => {
		expect.assertions(1);
		expect(isTypeCheckable("src/foo.js")).toBe(false);
	});

	it("should return false for .json files", () => {
		expect.assertions(1);
		expect(isTypeCheckable("tsconfig.json")).toBe(false);
	});
});
