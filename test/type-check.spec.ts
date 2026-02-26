import { createFilesMatcher, parseTsconfig } from "get-tsconfig";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PartialDeep } from "type-fest";
import { describe, expect, it, vi } from "vitest";

import {
	buildTypeCheckOutput,
	findTsconfigForFile,
	isTypeCheckable,
	partitionErrors,
	readTsconfigCache,
	resolveTsconfig,
	resolveViaReferences,
	runTypeCheck,
	typeCheck,
	typecheckStopDecision,
	writeTsconfigCache,
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
	return fromPartial({
		existsSync: vi.fn<typeof existsSync>(() => false),
		mkdirSync: vi.fn<typeof mkdirSync>(),
		readFileSync: vi.fn<typeof readFileSync>(),
		writeFileSync: vi.fn<typeof writeFileSync>(),
	});
});

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

vi.mock(import("node:crypto"), async () => {
	return fromPartial({
		createHash: vi.fn<typeof createHash>(),
	});
});

const mockedCreateHash = vi.mocked(createHash);

vi.mock(import("get-tsconfig"), async () => {
	return fromPartial({
		createFilesMatcher: vi.fn<typeof createFilesMatcher>(),
		parseTsconfig: vi.fn<typeof parseTsconfig>(),
	});
});

const mockedParseTsconfig = vi.mocked(parseTsconfig);

describe(readTsconfigCache, () => {
	it("should return undefined when no cache file exists", () => {
		expect.assertions(1);

		mockedExistsSync.mockReturnValue(false);

		expect(readTsconfigCache(join("/project"))).toBeUndefined();
	});

	it("should return parsed cache when file exists", () => {
		expect.assertions(1);

		const projectDirectory = join("/project");
		const cachePath = join(projectDirectory, ".claude", "state", "tsconfig-cache.json");
		const cache = {
			hashes: { "/project/tsconfig.json": "abc123" },
			mappings: { "src/foo.ts": "/project/tsconfig.json" },
			projectRoot: projectDirectory,
		};

		mockedExistsSync.mockImplementation((path) => path === cachePath);
		mockedReadFileSync.mockReturnValue(JSON.stringify(cache));

		expect(readTsconfigCache(projectDirectory)).toStrictEqual(cache);
	});
});

describe(writeTsconfigCache, () => {
	it("should create state directory and write cache object", () => {
		expect.assertions(2);

		const projectDirectory = join("/project");
		const cache = {
			hashes: { "/project/tsconfig.json": "abc123" },
			mappings: { "src/foo.ts": "/project/tsconfig.json" },
			projectRoot: projectDirectory,
		};

		writeTsconfigCache(projectDirectory, cache);

		expect(mockedMkdirSync).toHaveBeenCalledWith(join(projectDirectory, ".claude", "state"), {
			recursive: true,
		});
		expect(mockedWriteFileSync).toHaveBeenCalledWith(
			join(projectDirectory, ".claude", "state", "tsconfig-cache.json"),
			JSON.stringify(cache),
		);
	});
});

describe(resolveTsconfig, () => {
	it("should fall back to findTsconfigForFile on cache miss and write cache", () => {
		expect.assertions(2);

		const projectDirectory = join("/project");
		const filePath = join(projectDirectory, "src", "foo.ts");
		const tsconfig = join(projectDirectory, "tsconfig.json");

		// No cache file exists, but tsconfig exists for the walk
		mockedExistsSync.mockImplementation((path) => path === tsconfig);
		mockedParseTsconfig.mockReturnValue(fromPartial({ references: undefined }));

		const mockDigest = vi.fn<() => string>().mockReturnValue("new-hash");
		const mockUpdate = vi
			.fn<(data: string) => { digest: typeof mockDigest }>()
			.mockReturnValue({ digest: mockDigest });
		mockedCreateHash.mockReturnValue({ update: mockUpdate } as never);
		mockedReadFileSync.mockReturnValue("tsconfig content");

		const result = resolveTsconfig(filePath, projectDirectory);

		expect(result).toBe(tsconfig);
		expect(mockedWriteFileSync).toHaveBeenCalledWith(
			join(projectDirectory, ".claude", "state", "tsconfig-cache.json"),
			expect.any(String),
		);
	});

	it("should use cached tsconfig when hash matches", () => {
		expect.assertions(1);

		const projectDirectory = join("/project");
		const filePath = join(projectDirectory, "src", "foo.ts");
		const tsconfig = join(projectDirectory, "tsconfig.json");
		const cachePath = join(projectDirectory, ".claude", "state", "tsconfig-cache.json");
		const cache = {
			hashes: { [tsconfig]: "cached-hash" },
			mappings: { [filePath]: tsconfig },
			projectRoot: projectDirectory,
		};

		mockedExistsSync.mockImplementation((path) => path === cachePath || path === tsconfig);
		mockedReadFileSync.mockReturnValue(JSON.stringify(cache));

		const mockDigest = vi.fn<() => string>().mockReturnValue("cached-hash");
		const mockUpdate = vi
			.fn<(data: string) => { digest: typeof mockDigest }>()
			.mockReturnValue({ digest: mockDigest });
		mockedCreateHash.mockReturnValue({ update: mockUpdate } as never);

		expect(resolveTsconfig(filePath, projectDirectory)).toBe(tsconfig);
	});
});

describe(resolveViaReferences, () => {
	it("should return undefined when tsconfig has no references", () => {
		expect.assertions(1);

		mockedParseTsconfig.mockReturnValue(fromPartial({ references: undefined }));

		expect(
			resolveViaReferences("/project", "/project/tsconfig.json", "/project/src/foo.ts"),
		).toBeUndefined();
	});

	it("should return referenced tsconfig when file matches", () => {
		expect.assertions(1);

		const projectDirectory = join("/project");
		const rootTsconfig = join(projectDirectory, "tsconfig.json");
		const refDirectory = join(projectDirectory, "packages", "app");
		const refTsconfig = join(refDirectory, "tsconfig.json");
		const targetFile = join(refDirectory, "src", "foo.ts");

		mockedParseTsconfig.mockImplementation((configPath) => {
			if (configPath === rootTsconfig) {
				return fromPartial({ references: [{ path: "./packages/app" }] });
			}

			return fromPartial({});
		});
		mockedExistsSync.mockImplementation((path) => path === refTsconfig);

		const mockedMatcher = vi
			.fn<ReturnType<typeof createFilesMatcher>>()
			.mockReturnValue(fromPartial({}));
		vi.mocked(createFilesMatcher).mockReturnValue(mockedMatcher);

		expect(resolveViaReferences(projectDirectory, rootTsconfig, targetFile)).toBe(refTsconfig);
	});
});

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
		mockedParseTsconfig.mockReturnValue(fromPartial({ references: undefined }));

		const mockDigest = vi.fn<() => string>().mockReturnValue("hash");
		const mockUpdate = vi
			.fn<(data: string) => { digest: typeof mockDigest }>()
			.mockReturnValue({ digest: mockDigest });
		mockedCreateHash.mockReturnValue({ update: mockUpdate } as never);

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
		expect(result?.systemMessage).toContain("1 type error in edited file");
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

	it("should resolve via references when root tsconfig has project references", () => {
		expect.assertions(1);

		const projectDirectory = join("/project");
		const rootTsconfig = join(projectDirectory, "tsconfig.json");
		const refTsconfig = join(projectDirectory, "configs", "app.json");
		const targetFile = join(projectDirectory, "src", "foo.ts");

		// Walk finds root tsconfig (no tsconfig in src/). Ref tsconfig is
		// elsewhere.
		mockedExistsSync.mockImplementation(
			(path) => path === rootTsconfig || path === refTsconfig,
		);
		mockedParseTsconfig.mockImplementation((configPath) => {
			if (configPath === rootTsconfig) {
				return fromPartial({ references: [{ path: "./configs/app.json" }] });
			}

			return fromPartial({});
		});

		const mockedMatcher = vi
			.fn<ReturnType<typeof createFilesMatcher>>()
			.mockReturnValue(fromPartial({}));
		vi.mocked(createFilesMatcher).mockReturnValue(mockedMatcher);

		expect(findTsconfigForFile(targetFile, projectDirectory)).toBe(refTsconfig);
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

describe(partitionErrors, () => {
	it("should separate edited file errors from dependency errors", () => {
		expect.assertions(2);

		const errors = [
			"src/foo.ts(1,1): error TS2322: Type mismatch",
			"src/bar.ts(5,3): error TS2345: Argument mismatch",
			"src/foo.ts(10,1): error TS2741: Missing property",
		];

		const result = partitionErrors(errors, join("/project", "src", "foo.ts"), join("/project"));

		expect(result.fileErrors).toStrictEqual([
			"src/foo.ts(1,1): error TS2322: Type mismatch",
			"src/foo.ts(10,1): error TS2741: Missing property",
		]);
		expect(result.dependencyErrors).toStrictEqual([
			"src/bar.ts(5,3): error TS2345: Argument mismatch",
		]);
	});
});

describe(buildTypeCheckOutput, () => {
	it("should format file errors and dependency errors separately", () => {
		expect.assertions(2);

		const fileErrors = ["src/foo.ts(1,1): error TS2322: Type mismatch"];
		const dependencyErrors = ["src/bar.ts(5,3): error TS2345: Argument mismatch"];
		const result = buildTypeCheckOutput({
			dependencyErrors,
			fileErrors,
			totalDependencyErrors: 1,
			totalFileErrors: 1,
		});

		expect(result.systemMessage).toContain("1 type error in edited file");
		expect(result.systemMessage).toContain("1 type error in other files");
	});

	it("should show total counts when truncated", () => {
		expect.assertions(2);

		const fileErrors = ["src/foo.ts(1,1): error TS2322: Type mismatch"];
		const dependencyErrors = ["src/bar.ts(5,3): error TS2345: Argument mismatch"];
		const result = buildTypeCheckOutput({
			dependencyErrors,
			fileErrors,
			totalDependencyErrors: 20,
			totalFileErrors: 30,
		});

		expect(result.systemMessage).toContain("30 type errors in edited file");
		expect(result.systemMessage).toContain("20 type errors in other files");
	});

	it("should only show dependency errors when no file errors", () => {
		expect.assertions(2);

		const fileErrors: Array<string> = [];
		const dependencyErrors = ["src/bar.ts(5,3): error TS2345: Argument mismatch"];
		const result = buildTypeCheckOutput({
			dependencyErrors,
			fileErrors,
			totalDependencyErrors: 1,
			totalFileErrors: 0,
		});

		expect(result.systemMessage).not.toContain("in edited file");
		expect(result.systemMessage).toContain("1 type error in other files");
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

describe(typecheckStopDecision, () => {
	it("should return undefined when no errors", () => {
		expect.assertions(1);

		expect(
			typecheckStopDecision({
				errorFiles: [],
				lintAttempts: {},
				maxLintAttempts: 3,
				stopAttempts: 0,
			}),
		).toBeUndefined();
	});
});
