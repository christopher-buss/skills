import type { BaseHookInput } from "@anthropic-ai/claude-agent-sdk";

import { createFromFile } from "file-entry-cache";
import type { ChildProcess, spawnSync } from "node:child_process";
import { execFileSync, execSync, spawn } from "node:child_process";
import {
	existsSync,
	globSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import type { PartialDeep } from "type-fest";
import { describe, expect, it, vi } from "vitest";

import {
	buildHookOutput,
	clearCache,
	clearEditedFiles,
	clearLintAttempt,
	DEFAULT_CACHE_BUST,
	findEntryPoints,
	findSourceRoot,
	formatErrors,
	getBucketKey,
	getChangedFiles,
	getDependencyGraph,
	getLastSurfacedAt,
	getTransitiveDependents,
	incrementLintAttempt,
	invalidateCacheEntries,
	invertGraph,
	isInProject,
	isLintableFile,
	isProtectedFile,
	lint,
	loadLiveSessions,
	main,
	markBucketSurfaced,
	narrowToolInput,
	pruneDeadSessions,
	readEditedFiles,
	readLintAttempts,
	readSettings,
	readStopAttempts,
	registerSession,
	resolveBustFiles,
	restartDaemon,
	runEslint,
	runOxlint,
	shouldBustCache,
	stopDecision,
	writeEditedFile,
	writeLintAttempts,
	writeStopAttempts,
} from "../scripts/lint.js";

function fromPartial<T>(mock: PartialDeep<NoInfer<T>>): T {
	return mock as T;
}

vi.mock(import("node:child_process"), async () => {
	return fromPartial({
		execFileSync: vi.fn<typeof execFileSync>(),
		execSync: vi.fn<typeof execSync>(),
		spawn: vi.fn<typeof spawn>(),
		spawnSync: vi.fn<typeof spawnSync>(),
	});
});

vi.mock(import("node:fs"), async () => {
	return fromPartial({
		existsSync: vi.fn<typeof existsSync>(() => false),
		globSync: vi.fn<typeof globSync>(() => []),
		mkdirSync: vi.fn<typeof mkdirSync>(),
		readdirSync: vi.fn<(path: string) => Array<string>>(() => []),
		readFileSync: vi.fn<typeof readFileSync>(),
		statSync: vi.fn<typeof statSync>(),
		unlinkSync: vi.fn<typeof unlinkSync>(),
		writeFileSync: vi.fn<typeof writeFileSync>(),
	});
});

vi.mock(import("file-entry-cache"), async () => {
	return fromPartial({
		createFromFile: vi.fn<typeof createFromFile>(() => {
			return fromPartial({
				reconcile: vi.fn<() => void>(),
				removeEntry: vi.fn<(key: string) => void>(),
			});
		}),
	});
});

const mockedExecSync = vi.mocked(execSync);
const mockedExecFileSync = vi.mocked(execFileSync);
const mockedSpawn = vi.mocked(spawn);
const mockedExistsSync = vi.mocked(existsSync);
const mockedGlobSync = vi.mocked(globSync) as unknown as ReturnType<
	typeof vi.fn<(pattern: string) => Array<string>>
>;
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedStatSync = vi.mocked(statSync);
const mockedUnlinkSync = vi.mocked(unlinkSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedCreateFromFile = vi.mocked(createFromFile);

function fakeSpawnResult(): ChildProcess {
	const self: ChildProcess = fromPartial<ChildProcess>({
		on(_event: string, _handler: () => void): ChildProcess {
			return self;
		},
		stderr: fromPartial({
			on(_event: string, _handler: () => void): ChildProcess {
				return self;
			},
		}),
		unref: () => {},
	});
	return self;
}

// Pin platform to linux for the whole file. Some tests cover platform-specific
// branches (case-insensitive path comparisons, win32 runEslint spawn) — those
// save/restore inline. See vitest/no-hooks: no beforeEach/afterEach allowed.
Object.defineProperty(process, "platform", { value: "linux" });

describe(lint, () => {
	describe(isInProject, () => {
		it("should return true when CLAUDE_PROJECT_DIR is not set", () => {
			expect.assertions(1);

			vi.stubEnv("CLAUDE_PROJECT_DIR", "");

			expect(isInProject("/anywhere/file.ts")).toBe(true);

			vi.unstubAllEnvs();
		});

		it("should return true for a file inside the project", () => {
			expect.assertions(1);

			vi.stubEnv("CLAUDE_PROJECT_DIR", "/project");

			expect(isInProject(join("/project", "src", "index.ts"))).toBe(true);

			vi.unstubAllEnvs();
		});

		it("should return false for a file outside the project", () => {
			expect.assertions(1);

			vi.stubEnv("CLAUDE_PROJECT_DIR", "/project");

			expect(isInProject("/other/path/file.ts")).toBe(false);

			vi.unstubAllEnvs();
		});

		it("should return false for a path sharing a prefix but not a child", () => {
			expect.assertions(1);

			vi.stubEnv("CLAUDE_PROJECT_DIR", "/project");

			expect(isInProject("/project-other/file.ts")).toBe(false);

			vi.unstubAllEnvs();
		});

		it("should return true for the project directory itself", () => {
			expect.assertions(1);

			vi.stubEnv("CLAUDE_PROJECT_DIR", "/project");

			expect(isInProject("/project")).toBe(true);

			vi.unstubAllEnvs();
		});

		it("should use case-sensitive comparison on non-windows", () => {
			expect.assertions(1);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "linux" });
			vi.stubEnv("CLAUDE_PROJECT_DIR", "/Project");

			expect(isInProject("/project/file.ts")).toBe(false);

			Object.defineProperty(process, "platform", { value: originalPlatform });
			vi.unstubAllEnvs();
		});
	});

	describe(isLintableFile, () => {
		it("should return true for .ts file", () => {
			expect.assertions(1);

			expect(isLintableFile("src/index.ts")).toBe(true);
		});

		it("should return false for .txt file", () => {
			expect.assertions(1);

			expect(isLintableFile("readme.txt")).toBe(false);
		});

		it("should respect custom extensions list", () => {
			expect.assertions(2);

			expect(isLintableFile("app.vue", [".vue", ".ts"])).toBe(true);
			expect(isLintableFile("app.ts", [".vue"])).toBe(false);
		});
	});

	describe(findSourceRoot, () => {
		const packageJson = join("/project", "package.json");
		const sourceDirectory = join("/project", "src");

		it("should return src/ when package.json and src/ both exist", () => {
			expect.assertions(1);

			const existing = new Set([packageJson, sourceDirectory]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));

			expect(findSourceRoot(join("/project", "src", "foo.ts"))).toBe(sourceDirectory);
		});

		it("should return project root when no src/ directory", () => {
			expect.assertions(1);

			const existing = new Set([packageJson]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));

			expect(findSourceRoot(join("/project", "lib", "foo.ts"))).toBe(join("/project"));
		});

		it("should walk up directories to find package.json", () => {
			expect.assertions(1);

			const existing = new Set([packageJson, sourceDirectory]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));

			expect(findSourceRoot(join("/project", "src", "deep", "nested", "foo.ts"))).toBe(
				join("/project", "src"),
			);
		});

		it("should return undefined when no package.json found", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(findSourceRoot(join("/project", "src", "foo.ts"))).toBeUndefined();
		});
	});

	describe(findEntryPoints, () => {
		it("should return only candidates that exist on disk", () => {
			expect.assertions(1);

			const sourceRoot = join("/project", "src");
			const existing = new Set([join(sourceRoot, "index.ts")]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));

			expect(findEntryPoints(sourceRoot)).toStrictEqual([join(sourceRoot, "index.ts")]);
		});

		it("should return empty array when no candidates exist", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(findEntryPoints(join("/project", "src"))).toStrictEqual([]);
		});
	});

	describe(invertGraph, () => {
		it("should find single importer of target file", () => {
			expect.assertions(1);

			const graph = { "app.ts": ["utils.ts"], "utils.ts": [] };

			expect(invertGraph(graph, "utils.ts")).toStrictEqual(["app.ts"]);
		});

		it("should return empty array when no importers", () => {
			expect.assertions(1);

			const graph = { "app.ts": ["utils.ts"], "utils.ts": [] };

			expect(invertGraph(graph, "app.ts")).toStrictEqual([]);
		});

		it("should find multiple importers of target file", () => {
			expect.assertions(1);

			const graph = {
				"a.ts": ["shared.ts"],
				"b.ts": ["shared.ts"],
				"shared.ts": [],
			};

			expect(invertGraph(graph, "shared.ts")).toStrictEqual(["a.ts", "b.ts"]);
		});
	});

	describe(getDependencyGraph, () => {
		it("should call execSync with correct madge command and parse JSON", () => {
			expect.assertions(2);

			const expectedGraph = { "app.ts": ["utils.ts"], "utils.ts": [] };
			mockedExecSync.mockReturnValue(JSON.stringify(expectedGraph));

			const result = getDependencyGraph("/src", ["/src/index.ts"]);

			expect(mockedExecSync).toHaveBeenCalledWith(
				'pnpm exec madge --json "/src/index.ts"',
				expect.objectContaining({ cwd: "/src" }),
			);
			expect(result).toStrictEqual(expectedGraph);
		});

		it("should throw when madge command fails", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation(() => {
				throw new Error("Command not found: madge");
			});

			expect(() => getDependencyGraph("/src", ["/src/index.ts"])).toThrowError(
				"Command not found: madge",
			);
		});
	});

	const testFilePath = "/project/src/foo.ts";
	const testErrorLine = "  1:5  error  no-unused-vars";

	describe(invalidateCacheEntries, () => {
		it("should be no-op for empty file list", () => {
			expect.assertions(1);

			invalidateCacheEntries([]);

			expect(mockedCreateFromFile).not.toHaveBeenCalled();
		});

		it("should be no-op when cache file does not exist", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			invalidateCacheEntries([testFilePath]);

			expect(mockedCreateFromFile).not.toHaveBeenCalled();
		});

		it("should remove entries and reconcile cache", () => {
			expect.assertions(2);

			const removed: Array<string> = [];
			let isReconciled = false;

			mockedExistsSync.mockReturnValue(true);
			mockedCreateFromFile.mockReturnValue(
				fromPartial({
					reconcile() {
						isReconciled = true;
					},
					removeEntry(key: string) {
						removed.push(key);
					},
				}),
			);

			invalidateCacheEntries(["/project/src/a.ts", "/project/src/b.ts"]);

			expect(removed).toStrictEqual(["/project/src/a.ts", "/project/src/b.ts"]);
			expect(isReconciled).toBe(true);
		});
	});

	describe(runEslint, () => {
		// Outer module-scope sets platform=linux for the whole file; this block
		// inherits that and exercises the POSIX execSync branch of runEslint.

		it("should run eslint_d with correct args and ESLINT_IN_EDITOR env", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();
			mockedExecSync.mockReturnValue("");

			runEslint([testFilePath]);

			const callArgs = mockedExecSync.mock.calls[0]!;

			expect(callArgs[0]).toBe(`pnpm exec eslint_d --cache "${testFilePath}"`);

			const options = callArgs[1] as Record<string, unknown>;

			expect(options["env"]).toMatchObject({
				ESLINT_IN_EDITOR: "true",
			});
		});

		it("should capture stdout/stderr/message on error", () => {
			expect.assertions(1);

			const error = new Error("Command failed") as Error & {
				stderr: Buffer;
				stdout: Buffer;
			};
			error.stdout = Buffer.from(`${testErrorLine}\n`);
			error.stderr = Buffer.from("");
			mockedExecSync.mockImplementation(() => {
				throw error;
			});

			const result = runEslint([testFilePath]);

			expect(result).toContain("no-unused-vars");
		});

		it("should fall back to stderr when stdout is empty", () => {
			expect.assertions(1);

			const error = new Error("fail") as Error & {
				stderr: Buffer;
				stdout: Buffer;
			};
			error.stdout = Buffer.from("");
			error.stderr = Buffer.from("stderr output");
			mockedExecSync.mockImplementation(() => {
				throw error;
			});

			expect(runEslint([testFilePath])).toBe("stderr output");
		});

		it("should fall back to message when error has no stdout/stderr properties", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation(() => {
				throw new Error("plain error");
			});

			expect(runEslint([testFilePath])).toBe("plain error");
		});

		it("should return empty string when error has no properties", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation(() => {
				// eslint-disable-next-line ts/only-throw-error -- testing edge case
				throw { stderr: Buffer.from(""), stdout: Buffer.from("") };
			});

			expect(runEslint([testFilePath])).toBe("");
		});

		it("should fall back to message when stdout and stderr are empty", () => {
			expect.assertions(1);

			const error = new Error("error message") as Error & {
				stderr: Buffer;
				stdout: Buffer;
			};
			error.stdout = Buffer.from("");
			error.stderr = Buffer.from("");
			mockedExecSync.mockImplementation(() => {
				throw error;
			});

			expect(runEslint([testFilePath])).toBe("error message");
		});

		it("should batch multiple files into a single invocation", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();
			mockedExecSync.mockReturnValue("");

			runEslint(["/project/src/a.ts", "/project/src/b.ts"]);

			expect(mockedExecSync).toHaveBeenCalledOnce();
			expect(mockedExecSync.mock.calls[0]![0]).toBe(
				'pnpm exec eslint_d --cache "/project/src/a.ts" "/project/src/b.ts"',
			);
		});

		it("should be a no-op when filePaths is empty", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();

			const result = runEslint([]);

			expect(result).toBeUndefined();
			expect(mockedExecSync).not.toHaveBeenCalled();
		});

		it("should chunk into multiple invocations when command exceeds 32k chars", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();
			mockedExecSync.mockReturnValue("");

			// Each path quoted + space is ~110 chars; ~300 paths overflow 32k.
			const files = Array.from({ length: 500 }, (_, index) => {
				return `/project/src/some/deeply/nested/directory/file_${String(index).padStart(4, "0")}_with_a_long_name.ts`;
			});

			runEslint(files);

			expect(mockedExecSync.mock.calls.length).toBeGreaterThan(1);
			expect(mockedExecSync.mock.calls.every((call) => call[0].length <= 32_000)).toBe(true);
		});

		it("should concatenate outputs across chunks", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();

			const files = Array.from({ length: 500 }, (_, index) => {
				return `/project/src/some/deeply/nested/directory/file_${String(index).padStart(4, "0")}_with_a_long_name.ts`;
			});

			let callIndex = 0;
			mockedExecSync.mockImplementation(() => {
				const error = new Error(`fail-${callIndex}`) as Error & {
					stderr: Buffer;
					stdout: Buffer;
				};
				error.stdout = Buffer.from(`chunk-${callIndex}-error\n`);
				error.stderr = Buffer.from("");
				callIndex += 1;
				throw error;
			});

			const result = runEslint(files);

			expect(result).toContain("chunk-0-error");
			expect(result).toContain("chunk-1-error");
		});
	});

	describe("runEslint (win32)", () => {
		function findStartProcessCall(): Parameters<typeof execFileSync> | undefined {
			return mockedExecFileSync.mock.calls.find((call) => {
				const args = call[1];
				return (
					Array.isArray(args) &&
					args.some((argument: string) => argument.includes("Start-Process"))
				);
			});
		}

		it("should spawn via powershell.exe Start-Process with cmd.exe redirection", () => {
			expect.assertions(4);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedReadFileSync.mockReset();
			mockedExecFileSync.mockReturnValue(Buffer.from(""));

			const result = runEslint([testFilePath]);

			expect(result).toBeUndefined();

			// getClaudePid may also call execFileSync(powershell.exe, ...) — pick
			// the Start-Process call.
			const psCall = findStartProcessCall();

			expect(psCall?.[0]).toBe("powershell.exe");

			const psCommand = (psCall![1] as Array<string>)[2]!;

			expect(psCommand).toContain("Start-Process -FilePath 'cmd.exe'");
			expect(psCommand).toMatch(/> "[^"]*eslint_d_out_[^"]*" 2> "[^"]*eslint_d_err_[^"]*"/);

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should not pass -RedirectStandardOutput on Start-Process", () => {
			expect.assertions(1);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedReadFileSync.mockReset();
			mockedExecFileSync.mockReturnValue(Buffer.from(""));

			runEslint([testFilePath]);

			const psCommand = (findStartProcessCall()![1] as Array<string>)[2]!;

			expect(psCommand).not.toMatch(/-RedirectStandard(Output|Error|Input)/);

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should return stdout content when eslint_d exits non-zero", () => {
			expect.assertions(1);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedReadFileSync.mockReset();
			mockedExecFileSync.mockImplementation(() => {
				// eslint-disable-next-line ts/only-throw-error -- mimic execFileSync error shape
				throw { status: 1 };
			});
			mockedReadFileSync.mockImplementation((path) => {
				if (typeof path === "string" && path.includes("eslint_d_out_")) {
					return "lint failure output";
				}

				return "";
			});

			expect(runEslint([testFilePath])).toBe("lint failure output");

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should fall back to stderr when stdout is empty", () => {
			expect.assertions(1);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedReadFileSync.mockReset();
			mockedExecFileSync.mockImplementation(() => {
				// eslint-disable-next-line ts/only-throw-error -- mimic execFileSync error shape
				throw { status: 2 };
			});
			mockedReadFileSync.mockImplementation((path) => {
				if (typeof path === "string" && path.includes("eslint_d_err_")) {
					return "stderr only";
				}

				return "";
			});

			expect(runEslint([testFilePath])).toBe("stderr only");

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should clean up both temp files", () => {
			expect.assertions(2);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedReadFileSync.mockReset();
			mockedExecFileSync.mockReturnValue(Buffer.from(""));
			mockedReadFileSync.mockReturnValue("");
			mockedUnlinkSync.mockClear();

			runEslint([testFilePath]);

			const unlinkPaths = mockedUnlinkSync.mock.calls.map((call) => String(call[0]));

			expect(unlinkPaths.some((entry) => entry.includes("eslint_d_out_"))).toBe(true);
			expect(unlinkPaths.some((entry) => entry.includes("eslint_d_err_"))).toBe(true);

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should refuse paths containing '%' (would be expanded by cmd.exe)", () => {
			expect.assertions(2);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedExecFileSync.mockReturnValue(Buffer.from(""));

			const result = runEslint(["C:/repo/config%env%.ts"]);

			expect(result).toMatch(/cannot safely run.*'%'/);
			expect(findStartProcessCall()).toBeUndefined();

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should embed all files in a single cmd.exe invocation on win32", () => {
			expect.assertions(2);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedReadFileSync.mockReset();
			mockedExecFileSync.mockReturnValue(Buffer.from(""));

			runEslint(["C:/repo/a.ts", "C:/repo/b.ts"]);

			const psCommand = (findStartProcessCall()![1] as Array<string>)[2]!;

			expect(psCommand).toContain('"C:/repo/a.ts"');
			expect(psCommand).toContain('"C:/repo/b.ts"');

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should reject the entire batch on win32 if any file contains '%'", () => {
			expect.assertions(2);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedExecFileSync.mockReturnValue(Buffer.from(""));

			const result = runEslint(["C:/repo/ok.ts", "C:/repo/bad%env%.ts"]);

			expect(result).toMatch(/cannot safely run.*'%'/);
			expect(findStartProcessCall()).toBeUndefined();

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});

		it("should surface launcher stderr when execFileSync fails", () => {
			expect.assertions(1);

			const originalPlatform = process.platform;
			Object.defineProperty(process, "platform", { value: "win32" });
			mockedExecFileSync.mockReset();
			mockedReadFileSync.mockReset();
			mockedExecFileSync.mockImplementation(() => {
				// eslint-disable-next-line ts/only-throw-error -- mimic execFileSync error shape
				throw { status: 9, stderr: Buffer.from("Start-Process: Access denied\n") };
			});
			mockedReadFileSync.mockReturnValue("");

			expect(runEslint([testFilePath])).toContain("Access denied");

			Object.defineProperty(process, "platform", { value: originalPlatform });
		});
	});

	describe(restartDaemon, () => {
		it("should write restart script and spawn background process", () => {
			expect.assertions(1);

			restartDaemon();

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				expect.stringContaining(".eslint_bg_"),
				expect.stringContaining("eslint_d restart"),
			);
		});

		it("should swallow spawn errors", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockImplementationOnce(() => {
				throw new Error("spawn failed");
			});

			restartDaemon();

			expect(true).toBe(true);
		});
	});

	describe(formatErrors, () => {
		it("should extract error lines from eslint output", () => {
			expect.assertions(2);

			const output = `${testErrorLine}\n  2:1  warning  no-console\n`;
			const result = formatErrors(output);

			expect(result.lines).toStrictEqual([testErrorLine]);
			expect(result.totalIssues).toBe(1);
		});

		it("should cap surfaced lines at the configured max", () => {
			expect.assertions(2);

			const lines = Array.from(
				{ length: 15 },
				(_, index) => `  ${index}:1  error  rule-${index}`,
			);
			const output = lines.join("\n");

			const result = formatErrors(output);

			expect(result.lines).toHaveLength(10);
			expect(result.totalIssues).toBe(15);
		});

		it("should cluster repeated rule violations into a single entry with count", () => {
			expect.assertions(3);

			const lines = Array.from(
				{ length: 7 },
				(_, index) => `  ${index}:1  error  no-explicit-any`,
			);
			const result = formatErrors(lines.join("\n"));

			expect(result.lines).toHaveLength(1);
			expect(result.lines[0]).toContain("(x7, rule: no-explicit-any)");
			expect(result.totalIssues).toBe(7);
		});

		it("should preserve distinct rule lines without clustering", () => {
			expect.assertions(2);

			const output = [
				"  1:5  error  no-unused-vars",
				"  2:1  error  no-undef",
				"  3:2  error  no-shadow",
			].join("\n");
			const result = formatErrors(output);

			expect(result.lines).toHaveLength(3);
			expect(result.totalIssues).toBe(3);
		});
	});

	describe(buildHookOutput, () => {
		it("should wrap output in workspace_diagnostics tag and use third-person voice", () => {
			expect.assertions(5);

			const result = buildHookOutput("foo.ts", { lines: [testErrorLine], totalIssues: 1 });

			expect(result).toMatchObject({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
				},
			});
			expect(result.systemMessage).toContain('<workspace_diagnostics source="eslint">');
			expect(result.systemMessage).toContain("</workspace_diagnostics>");
			expect(result.systemMessage).toContain("foo.ts shows 1 issue");
			expect(result.systemMessage).not.toMatch(/\byou\b/i);
		});

		it("should append a cap-overflow notice when total issues exceed surfaced lines", () => {
			expect.assertions(2);

			const lines = Array.from(
				{ length: 5 },
				(_, index) => `  ${index}:1  error  rule-${index}`,
			);
			const result = buildHookOutput("foo.ts", { lines, totalIssues: 12 });

			expect(result.systemMessage).toContain("+ 7 more issues");
			expect(result.hookSpecificOutput!.additionalContext).toContain("pnpm lint");
		});

		it("should omit overflow notice when totals match", () => {
			expect.assertions(1);

			const result = buildHookOutput("foo.ts", { lines: [testErrorLine], totalIssues: 1 });

			expect(result.systemMessage).not.toContain("more issues");
		});
	});

	describe(getChangedFiles, () => {
		it("should return empty array when no changes", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			expect(getChangedFiles()).toStrictEqual([]);
		});

		it("should parse git diff and untracked files into file list", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation((command) => {
				if (command.includes("git diff")) {
					return "src/foo.ts\nsrc/bar.ts\n";
				}

				if (command.includes("ls-files")) {
					return "src/new.ts\n";
				}

				return "";
			});

			expect(getChangedFiles()).toStrictEqual(["src/foo.ts", "src/bar.ts", "src/new.ts"]);
		});

		it("should exclude files outside the project", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation((command) => {
				if (command.includes("git diff")) {
					return "src/foo.ts\n../other-project/bar.ts\n";
				}

				if (command.includes("ls-files")) {
					return "../external/baz.ts\n";
				}

				return "";
			});

			expect(getChangedFiles()).toStrictEqual(["src/foo.ts"]);
		});
	});

	describe(readSettings, () => {
		it("should return defaults when no file exists", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(readSettings()).toStrictEqual({
				cacheBust: [...DEFAULT_CACHE_BUST],
				debug: false,
				eslint: true,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: false,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});
		});

		it("should return defaults when file has no frontmatter", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("no frontmatter here");

			expect(readSettings()).toStrictEqual({
				cacheBust: [...DEFAULT_CACHE_BUST],
				debug: false,
				eslint: true,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: false,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});
		});

		it("should skip malformed lines in frontmatter", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nno-colon-line\noxlint: "true"\n---\n');

			expect(readSettings()).toMatchObject({ oxlint: true });
		});

		it("should parse eslint and oxlint flags from frontmatter", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				'---\nlint: "true"\neslint: "false"\noxlint: "true"\n---\n',
			);

			expect(readSettings()).toStrictEqual({
				cacheBust: [...DEFAULT_CACHE_BUST],
				debug: false,
				eslint: false,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: true,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});
		});

		it("should parse lint-cadence: tiered", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nlint-cadence: "tiered"\n---\n');

			expect(readSettings()).toMatchObject({ lintCadence: "tiered" });
		});

		it("should parse lint-cadence: stop-only", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nlint-cadence: "stop-only"\n---\n');

			expect(readSettings()).toMatchObject({ lintCadence: "stop-only" });
		});

		it("should fall back to strict when lint-cadence is invalid", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nlint-cadence: "nonsense"\n---\n');

			expect(readSettings()).toMatchObject({ lintCadence: "strict" });
		});

		it("should parse max-lint-errors as a number", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nmax-lint-errors: "20"\n---\n');

			expect(readSettings()).toMatchObject({ maxLintErrors: 20 });
		});

		it("should fall back to default when max-lint-errors is non-numeric", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nmax-lint-errors: "abc"\n---\n');

			expect(readSettings()).toMatchObject({ maxLintErrors: 10 });
		});

		it("should parse max-lint-attempts as a number", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nmax-lint-attempts: "5"\n---\n');

			expect(readSettings()).toMatchObject({ maxLintAttempts: 5 });
		});

		it("should fall back to default when max-lint-attempts is non-numeric", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nmax-lint-attempts: "xyz"\n---\n');

			expect(readSettings()).toMatchObject({ maxLintAttempts: 1 });
		});

		it("should parse lint-auto-fix-on-batch: false", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nlint-auto-fix-on-batch: "false"\n---\n');

			expect(readSettings()).toMatchObject({ lintAutoFixOnBatch: false });
		});

		it("should fall back to default when lint-auto-fix-on-batch is invalid", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nlint-auto-fix-on-batch: "maybe"\n---\n');

			expect(readSettings()).toMatchObject({ lintAutoFixOnBatch: true });
		});
	});

	describe(runOxlint, () => {
		it("should run oxlint with correct command", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runOxlint(["/project/src/foo.ts"]);

			expect(mockedExecSync).toHaveBeenCalledWith(
				'pnpm exec oxlint "/project/src/foo.ts"',
				expect.anything(),
			);
		});

		it("should pass extra flags", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runOxlint(["/project/src/foo.ts"], ["--fix"]);

			expect(mockedExecSync).toHaveBeenCalledWith(
				'pnpm exec oxlint --fix "/project/src/foo.ts"',
				expect.anything(),
			);
		});

		it("should capture error output", () => {
			expect.assertions(1);

			const error = new Error("fail") as Error & {
				stderr: Buffer;
				stdout: Buffer;
			};
			error.stdout = Buffer.from("  1:5  error  no-unused-vars\n");
			error.stderr = Buffer.from("");
			mockedExecSync.mockImplementation(() => {
				throw error;
			});

			expect(runOxlint(["/project/src/foo.ts"])).toContain("no-unused-vars");
		});

		it("should return undefined on success", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			expect(runOxlint(["/project/src/foo.ts"])).toBeUndefined();
		});

		it("should return empty string when error has no properties", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation(() => {
				// eslint-disable-next-line ts/only-throw-error -- testing edge case
				throw { stderr: Buffer.from(""), stdout: Buffer.from("") };
			});

			expect(runOxlint(["/project/src/foo.ts"])).toBe("");
		});

		it("should batch multiple files into a single invocation", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();
			mockedExecSync.mockReturnValue("");

			runOxlint(["/project/src/a.ts", "/project/src/b.ts"]);

			expect(mockedExecSync).toHaveBeenCalledOnce();
			expect(mockedExecSync.mock.calls[0]![0]).toBe(
				'pnpm exec oxlint "/project/src/a.ts" "/project/src/b.ts"',
			);
		});

		it("should be a no-op when filePaths is empty", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();

			const result = runOxlint([]);

			expect(result).toBeUndefined();
			expect(mockedExecSync).not.toHaveBeenCalled();
		});

		it("should chunk into multiple invocations when command exceeds 32k chars", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();
			mockedExecSync.mockReturnValue("");

			const files = Array.from({ length: 500 }, (_, index) => {
				return `/project/src/some/deeply/nested/directory/file_${String(index).padStart(4, "0")}_with_a_long_name.ts`;
			});

			runOxlint(files);

			expect(mockedExecSync.mock.calls.length).toBeGreaterThan(1);
			expect(mockedExecSync.mock.calls.every((call) => call[0].length <= 32_000)).toBe(true);
		});
	});

	describe(main, () => {
		it("should invalidate cache for changed files before linting", () => {
			expect.assertions(1);

			vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			vi.spyOn(process.stderr, "write").mockReturnValue(true);
			mockedSpawn.mockReturnValue(fakeSpawnResult());

			const removed: Array<string> = [];
			mockedExistsSync.mockReturnValue(true);
			mockedCreateFromFile.mockReturnValue(
				fromPartial({
					reconcile: () => {},
					removeEntry(key: string) {
						removed.push(key);
					},
				}),
			);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("git diff")) {
					return "src/changed.ts\n";
				}

				return "";
			});

			main(["."]);

			expect(removed).toContain("src/changed.ts");

			vi.restoreAllMocks();
		});

		it("should exit cleanly when no errors", () => {
			expect.assertions(2);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExecSync.mockReturnValue("");
			mockedExistsSync.mockReturnValue(false);

			main(["."]);

			expect(exitSpy).not.toHaveBeenCalled();
			expect(stderrSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it("should exit 1 when eslint fails", () => {
			expect.assertions(1);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					throw new Error("lint failed");
				}

				return "";
			});

			main(["."]);

			expect(exitSpy).toHaveBeenCalledWith(1);

			vi.restoreAllMocks();
		});

		it("should not write to stderr when output is only config noise", () => {
			expect.assertions(1);

			vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					const error = new Error("fail") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from("[@config] noise only\n");
					error.stderr = Buffer.from("");
					throw error;
				}

				return "";
			});

			main(["."]);

			expect(stderrSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it("should filter config noise from output", () => {
			expect.assertions(2);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);

			const noisy = "[@config] some noise\nsrc/foo.ts\n  1:5  error  bad\n";
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					const error = new Error("fail") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from(noisy);
					error.stderr = Buffer.from("");
					throw error;
				}

				return "";
			});

			main(["."]);

			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(stderrSpy).toHaveBeenCalledWith(expect.not.stringContaining("@config"));

			vi.restoreAllMocks();
		});

		it("should exit 1 when oxlint fails", () => {
			expect.assertions(1);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			vi.spyOn(process.stderr, "write").mockReturnValue(true);
			mockedExistsSync.mockReturnValue(false);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("oxlint")) {
					throw new Error("oxlint error");
				}

				return "";
			});

			main(["."], {
				cacheBust: [],
				debug: false,
				eslint: false,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: true,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});

			expect(exitSpy).toHaveBeenCalledWith(1);

			vi.restoreAllMocks();
		});

		it("should run oxlint and skip eslint per settings", () => {
			expect.assertions(2);

			vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			vi.spyOn(process.stderr, "write").mockReturnValue(true);
			mockedExistsSync.mockReturnValue(false);

			let didRunOxlint = false;
			let didRunEslint = false;
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("oxlint")) {
					didRunOxlint = true;
				}

				if (command.includes("eslint_d")) {
					didRunEslint = true;
				}

				return "";
			});

			main(["."], {
				cacheBust: [],
				debug: false,
				eslint: false,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: true,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});

			expect(didRunOxlint).toBe(true);
			expect(didRunEslint).toBe(false);

			vi.restoreAllMocks();
		});
	});

	describe(lint, () => {
		it("should skip non-lintable files with early exit", () => {
			expect.assertions(1);

			const result = lint("readme.txt");

			expect(result).toBeUndefined();
		});

		it("should return undefined when eslint output has no error lines", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					const error = new Error("fail") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from("  1:5  warning  no-console\n");
					error.stderr = Buffer.from("");
					throw error;
				}

				return "";
			});

			const result = lint(join("/project", "src", "foo.ts"));

			expect(result).toBeUndefined();
		});

		it("should run full pipeline: importers → invalidate → eslint → restart", () => {
			expect.assertions(2);

			let didRunEslint = false;
			let didRestartDaemon = false;

			const projectSource = resolve("/project", "src");
			const existing = new Set([
				join(projectSource, "index.ts"),
				join(resolve("/project"), "package.json"),
				projectSource,
			]);

			mockedExistsSync.mockImplementation((path) => existing.has(path as string));
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					didRunEslint = true;
				}

				if (command.includes("madge")) {
					return '{"app.ts":["foo.ts"]}';
				}

				return "";
			});
			mockedWriteFileSync.mockImplementation((_path, content) => {
				if (typeof content === "string" && content.includes("eslint_d restart")) {
					didRestartDaemon = true;
				}
			});

			lint(join("/project", "src", "foo.ts"));

			expect(didRunEslint).toBe(true);
			expect(didRestartDaemon).toBe(true);
		});

		it("should skip daemon restart when restart option is false", () => {
			expect.assertions(2);

			let didRunEslint = false;
			let didRestartDaemon = false;

			const projectSource = resolve("/project", "src");
			const existing = new Set([
				join(projectSource, "index.ts"),
				join(resolve("/project"), "package.json"),
				projectSource,
			]);

			mockedExistsSync.mockImplementation((path) => existing.has(path as string));
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					didRunEslint = true;
				}

				if (command.includes("madge")) {
					return '{"app.ts":["foo.ts"]}';
				}

				return "";
			});
			mockedWriteFileSync.mockImplementation((_path, content) => {
				if (typeof content === "string" && content.includes("eslint_d restart")) {
					didRestartDaemon = true;
				}
			});

			lint(join("/project", "src", "foo.ts"), [], undefined, { restart: false });

			expect(didRunEslint).toBe(true);
			expect(didRestartDaemon).toBe(false);
		});

		it("should skip importers when no entry points found", () => {
			expect.assertions(1);

			const existing = new Set([
				join(resolve("/project"), "package.json"),
				resolve("/project", "src"),
			]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));
			mockedExecSync.mockReturnValue("");

			const result = lint(join("/project", "src", "foo.ts"));

			expect(result).toBeUndefined();
		});

		it("should propagate madge failure in importer resolution", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());
			const projectSource = resolve("/project", "src");
			const existing = new Set([
				join(projectSource, "index.ts"),
				join(resolve("/project"), "package.json"),
				projectSource,
			]);

			mockedExistsSync.mockImplementation((path) => existing.has(path as string));
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("madge")) {
					throw new Error("madge not found");
				}

				return "";
			});

			expect(() => lint(join("/project", "src", "foo.ts"))).toThrowError("madge not found");
		});

		it("should return formatted hook output on lint failure", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					const error = new Error("fail") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from(`${testErrorLine}\n`);
					error.stderr = Buffer.from("");
					throw error;
				}

				if (command.includes("madge")) {
					return "{}";
				}

				return "";
			});

			const result = lint(join("/project", "src", "foo.ts"));

			expect(result).toMatchObject({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
				},
			});
		});

		it("should return errors from oxlint when enabled", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("oxlint")) {
					const error = new Error("fail") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from(`${testErrorLine}\n`);
					error.stderr = Buffer.from("");
					throw error;
				}

				return "";
			});

			const result = lint(join("/project", "src", "foo.ts"), [], {
				cacheBust: [],
				debug: false,
				eslint: false,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: true,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});

			expect(result).toMatchObject({
				hookSpecificOutput: { hookEventName: "PostToolUse" },
			});
		});

		it("should skip oxlint when disabled (default settings)", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);

			let didRunOxlint = false;
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("oxlint")) {
					didRunOxlint = true;
				}

				return "";
			});

			lint(join("/project", "src", "foo.ts"));

			expect(didRunOxlint).toBe(false);
		});

		it("should run oxlint when enabled in settings", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());
			mockedExistsSync.mockReturnValue(false);

			let didRunOxlint = false;
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("oxlint")) {
					didRunOxlint = true;
				}

				return "";
			});

			lint(join("/project", "src", "foo.ts"), [], {
				cacheBust: [],
				debug: false,
				eslint: true,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: true,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});

			expect(didRunOxlint).toBe(true);
		});

		it("should skip eslint when disabled in settings", () => {
			expect.assertions(2);

			let didRunEslint = false;
			let didRestartDaemon = false;

			mockedExistsSync.mockReturnValue(false);
			mockedExecSync.mockImplementation((command) => {
				if (command.includes("eslint_d")) {
					didRunEslint = true;
				}

				return "";
			});
			mockedSpawn.mockImplementation(() => {
				didRestartDaemon = true;
				return fakeSpawnResult();
			});

			lint(join("/project", "src", "foo.ts"), [], {
				cacheBust: [],
				debug: false,
				eslint: false,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: false,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});

			expect(didRunEslint).toBe(false);
			expect(didRestartDaemon).toBe(false);
		});
	});

	describe("readSettings cacheBust", () => {
		it("should merge defaults with user patterns", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				"---\ncache-bust: cspell.config.yaml, !src/tsconfig.json\n---\n",
			);

			expect(readSettings()).toMatchObject({
				cacheBust: [...DEFAULT_CACHE_BUST, "cspell.config.yaml", "!src/tsconfig.json"],
			});
		});

		it("should default cacheBust to DEFAULT_CACHE_BUST", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(readSettings()).toMatchObject({
				cacheBust: [...DEFAULT_CACHE_BUST],
			});
		});
	});

	describe("readSettings runner", () => {
		it("should parse runner from frontmatter", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("---\nrunner: npx\n---\n");

			expect(readSettings()).toMatchObject({ runner: "npx" });
		});

		it("should default runner to pnpm exec", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("---\neslint: true\n---\n");

			expect(readSettings()).toMatchObject({ runner: "pnpm exec" });
		});

		it("should strip quotes from runner value", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('---\nrunner: "yarn dlx"\n---\n');

			expect(readSettings()).toMatchObject({ runner: "yarn dlx" });
		});
	});

	describe("readSettings maxLintAttempts", () => {
		it("should parse maxLintAttempts from frontmatter", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("---\nmax-lint-attempts: 5\n---\n");

			expect(readSettings()).toMatchObject({ maxLintAttempts: 5 });
		});

		it("should default maxLintAttempts to 1", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("---\neslint: true\n---\n");

			expect(readSettings()).toMatchObject({ maxLintAttempts: 1 });
		});
	});

	describe("custom runner commands", () => {
		it("should use custom runner in eslint command", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runEslint([testFilePath], [], "npx");

			expect(mockedExecSync).toHaveBeenCalledWith(
				`npx eslint_d --cache "${testFilePath}"`,
				expect.anything(),
			);
		});

		it("should use custom runner in oxlint command", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runOxlint([testFilePath], [], "npx");

			expect(mockedExecSync).toHaveBeenCalledWith(
				`npx oxlint "${testFilePath}"`,
				expect.anything(),
			);
		});

		it("should embed custom runner in restart script", () => {
			expect.assertions(1);

			restartDaemon("yarn dlx");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				expect.stringContaining(".eslint_bg_"),
				expect.stringContaining("yarn dlx"),
			);
		});

		it("should use custom runner in getDependencyGraph", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("{}");

			getDependencyGraph("/src", ["/src/index.ts"], "npx");

			expect(mockedExecSync).toHaveBeenCalledWith(
				'npx madge --json "/src/index.ts"',
				expect.anything(),
			);
		});
	});

	describe(resolveBustFiles, () => {
		it("should expand glob patterns via globSync", () => {
			expect.assertions(1);

			mockedGlobSync.mockImplementation((pattern) => {
				if (pattern === "**/*.config.ts") {
					return ["eslint.config.ts", "vitest.config.ts"];
				}

				return [];
			});

			expect(resolveBustFiles(["**/*.config.ts"])).toStrictEqual([
				"eslint.config.ts",
				"vitest.config.ts",
			]);
		});

		it("should return empty array when no matches", () => {
			expect.assertions(1);

			mockedGlobSync.mockReturnValue([]);

			expect(resolveBustFiles(["**/*.nope"])).toStrictEqual([]);
		});

		it("should flatten results from multiple patterns", () => {
			expect.assertions(1);

			mockedGlobSync.mockImplementation((pattern) => {
				if (pattern === "a.*") {
					return ["a.ts"];
				}

				if (pattern === "b.*") {
					return ["b.ts"];
				}

				return [];
			});

			expect(resolveBustFiles(["a.*", "b.*"])).toStrictEqual(["a.ts", "b.ts"]);
		});

		it("should filter negated patterns from results", () => {
			expect.assertions(1);

			mockedGlobSync.mockImplementation((pattern) => {
				if (pattern === "*.config.*") {
					return ["eslint.config.ts", "vitest.config.ts"];
				}

				if (pattern === "vitest.config.ts") {
					return ["vitest.config.ts"];
				}

				return [];
			});

			expect(resolveBustFiles(["*.config.*", "!vitest.config.ts"])).toStrictEqual([
				"eslint.config.ts",
			]);
		});

		it("should return empty when negation removes all matches", () => {
			expect.assertions(1);

			mockedGlobSync.mockImplementation((pattern) => {
				if (pattern === "a.ts") {
					return ["a.ts"];
				}

				return [];
			});

			expect(resolveBustFiles(["a.ts", "!a.ts"])).toStrictEqual([]);
		});
	});

	describe(shouldBustCache, () => {
		it("should return true when glob-resolved file newer than cache", () => {
			expect.assertions(1);

			mockedGlobSync.mockReturnValue(["eslint.config.ts"]);
			mockedExistsSync.mockReturnValue(true);
			mockedStatSync.mockImplementation((path) => {
				return fromPartial({ mtimeMs: path === ".eslintcache" ? 100 : 200 });
			});

			expect(shouldBustCache(["eslint.config.*"])).toBe(true);
		});

		it("should return false when cache newer than bust file", () => {
			expect.assertions(1);

			mockedGlobSync.mockReturnValue(["eslint.config.ts"]);
			mockedExistsSync.mockReturnValue(true);
			mockedStatSync.mockImplementation((path) => {
				return fromPartial({ mtimeMs: path === ".eslintcache" ? 200 : 100 });
			});

			expect(shouldBustCache(["eslint.config.ts"])).toBe(false);
		});

		it("should return false when cache does not exist", () => {
			expect.assertions(1);

			mockedGlobSync.mockImplementation((pattern) => [pattern]);
			mockedExistsSync.mockImplementation((path) => path !== ".eslintcache");

			expect(shouldBustCache(["eslint.config.ts"])).toBe(false);
		});

		it("should return false when glob resolves no files", () => {
			expect.assertions(1);

			mockedGlobSync.mockReturnValue([]);
			mockedExistsSync.mockReturnValue(true);

			expect(shouldBustCache(["**/*.nope"])).toBe(false);
		});
	});

	describe(clearCache, () => {
		it("should delete cache file", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);

			clearCache();

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".eslintcache");
		});

		it("should no-op when cache missing", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockReturnValue(false);

			clearCache();

			expect(mockedUnlinkSync).not.toHaveBeenCalled();
		});
	});

	describe("cache busting integration", () => {
		it("should clear full cache in lint when bust triggered", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedGlobSync.mockImplementation((pattern) => [pattern]);
			mockedExistsSync.mockReturnValue(true);
			mockedStatSync.mockImplementation((path) => {
				return fromPartial({ mtimeMs: (path as string) === ".eslintcache" ? 100 : 200 });
			});

			lint(join("/project", "src", "foo.ts"), [], {
				cacheBust: ["eslint.config.ts"],
				debug: false,
				eslint: true,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: false,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".eslintcache");
		});

		it("should clear full cache in main when bust triggered", () => {
			expect.assertions(1);

			vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			mockedUnlinkSync.mockClear();
			mockedGlobSync.mockImplementation((pattern) => [pattern]);
			mockedExistsSync.mockReturnValue(true);
			mockedStatSync.mockImplementation((path) => {
				return fromPartial({ mtimeMs: (path as string) === ".eslintcache" ? 100 : 200 });
			});

			main(["."], {
				cacheBust: ["eslint.config.ts"],
				debug: false,
				eslint: true,
				lint: true,
				lintAutoFixOnBatch: true,
				lintCadence: "strict",
				maxLintAttempts: 1,
				maxLintErrors: 10,
				oxlint: false,
				runner: "pnpm exec",
				typecheck: true,
				typecheckArgs: [],
			});

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".eslintcache");

			vi.restoreAllMocks();
		});
	});

	describe(readLintAttempts, () => {
		it("should return empty object when file missing", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(readLintAttempts("abc123")).toStrictEqual({});
		});

		it("should return inner per-file map for the given session", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123": { "src/foo.ts": 2 },
					"other-session": { "src/bar.ts": 1 },
				}),
			);

			expect(readLintAttempts("abc123")).toStrictEqual({ "src/foo.ts": 2 });
		});

		it("should return empty object for unknown session", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(JSON.stringify({ abc123: { "src/foo.ts": 2 } }));

			expect(readLintAttempts("zzz")).toStrictEqual({});
		});

		it("should return empty object on corrupt JSON", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("{bad json");

			expect(readLintAttempts("abc123")).toStrictEqual({});
		});
	});

	describe(writeLintAttempts, () => {
		it("should create dir and write per-session JSON when file missing", () => {
			expect.assertions(2);

			mockedMkdirSync.mockClear();
			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(false);

			writeLintAttempts("abc123", { "src/foo.ts": 2 });

			expect(mockedMkdirSync).toHaveBeenCalledWith(".claude/state", { recursive: true });
			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/lint-attempts.json",
				JSON.stringify({ abc123: { "src/foo.ts": 2 } }),
			);
		});

		it("should preserve sibling sessions when writing", () => {
			expect.assertions(2);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({ "other-session": { "src/bar.ts": 1 } }),
			);

			writeLintAttempts("abc123", { "src/foo.ts": 2 });

			const lastCall = mockedWriteFileSync.mock.lastCall!;

			expect(lastCall[0]).toBe(".claude/state/lint-attempts.json");
			expect(JSON.parse(lastCall[1] as string)).toStrictEqual({
				"abc123": { "src/foo.ts": 2 },
				"other-session": { "src/bar.ts": 1 },
			});
		});
	});

	describe(incrementLintAttempt, () => {
		it("should start at 1 when session and file are new", () => {
			expect.assertions(2);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(false);

			expect(incrementLintAttempt("abc123", "src/foo.ts")).toBe(1);
			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/lint-attempts.json",
				JSON.stringify({ abc123: { "src/foo.ts": 1 } }),
			);
		});

		it("should increment existing count for the file", () => {
			expect.assertions(2);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(JSON.stringify({ abc123: { "src/foo.ts": 2 } }));

			expect(incrementLintAttempt("abc123", "src/foo.ts")).toBe(3);
			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/lint-attempts.json",
				JSON.stringify({ abc123: { "src/foo.ts": 3 } }),
			);
		});

		it("should not affect other sessions", () => {
			expect.assertions(2);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({ "other-session": { "src/bar.ts": 5 } }),
			);

			incrementLintAttempt("abc123", "src/foo.ts");

			const lastCall = mockedWriteFileSync.mock.lastCall!;

			expect(lastCall[0]).toBe(".claude/state/lint-attempts.json");
			expect(JSON.parse(lastCall[1] as string)).toStrictEqual({
				"abc123": { "src/foo.ts": 1 },
				"other-session": { "src/bar.ts": 5 },
			});
		});
	});

	describe(clearLintAttempt, () => {
		it("should no-op when file missing", () => {
			expect.assertions(2);

			mockedUnlinkSync.mockClear();
			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(false);

			clearLintAttempt("abc123", "src/foo.ts");

			expect(mockedUnlinkSync).not.toHaveBeenCalled();
			expect(mockedWriteFileSync).not.toHaveBeenCalled();
		});

		it("should no-op when entry is absent", () => {
			expect.assertions(2);

			mockedUnlinkSync.mockClear();
			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(JSON.stringify({ abc123: { "src/bar.ts": 1 } }));

			clearLintAttempt("abc123", "src/foo.ts");

			expect(mockedUnlinkSync).not.toHaveBeenCalled();
			expect(mockedWriteFileSync).not.toHaveBeenCalled();
		});

		it("should drop just the file from the session map", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({ abc123: { "src/bar.ts": 1, "src/foo.ts": 2 } }),
			);

			clearLintAttempt("abc123", "src/foo.ts");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/lint-attempts.json",
				JSON.stringify({ abc123: { "src/bar.ts": 1 } }),
			);
		});

		it("should drop the session when its inner map empties", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123": { "src/foo.ts": 2 },
					"other-session": { "src/bar.ts": 1 },
				}),
			);

			clearLintAttempt("abc123", "src/foo.ts");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/lint-attempts.json",
				JSON.stringify({ "other-session": { "src/bar.ts": 1 } }),
			);
		});

		it("should unlink the file when no sessions survive", () => {
			expect.assertions(2);

			mockedUnlinkSync.mockClear();
			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(JSON.stringify({ abc123: { "src/foo.ts": 2 } }));

			clearLintAttempt("abc123", "src/foo.ts");

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".claude/state/lint-attempts.json");
			expect(mockedWriteFileSync).not.toHaveBeenCalled();
		});
	});

	describe(readStopAttempts, () => {
		it("should return 0 when file missing", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(readStopAttempts("abc123:main")).toBe(0);
		});

		it("should return per-bucket count", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({ "abc123:agent_xyz": 5, "abc123:main": 2 }),
			);

			expect(readStopAttempts("abc123:main")).toBe(2);
		});

		it("should return 0 for unknown bucket", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(JSON.stringify({ "abc123:main": 2 }));

			expect(readStopAttempts("zzz:main")).toBe(0);
		});

		it("should return 0 on corrupt JSON", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("{bad");

			expect(readStopAttempts("abc123:main")).toBe(0);
		});
	});

	describe(writeStopAttempts, () => {
		it("should create dir and write per-bucket count when file missing", () => {
			expect.assertions(2);

			mockedMkdirSync.mockClear();
			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(false);

			writeStopAttempts("abc123:main", 2);

			expect(mockedMkdirSync).toHaveBeenCalledWith(".claude/state", { recursive: true });
			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/stop-attempts.json",
				JSON.stringify({ "abc123:main": 2 }),
			);
		});

		it("should preserve sibling buckets when writing", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(JSON.stringify({ "abc123:agent_xyz": 5 }));

			writeStopAttempts("abc123:main", 2);

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/stop-attempts.json",
				JSON.stringify({ "abc123:agent_xyz": 5, "abc123:main": 2 }),
			);
		});
	});

	describe(stopDecision, () => {
		it("should allow stop when no error files", () => {
			expect.assertions(1);

			const result = stopDecision({
				errorFiles: [],
				lintAttempts: {},
				maxLintAttempts: 1,
				stopAttempts: 0,
			});

			expect(result).toBeUndefined();
		});

		it("should reset stop attempts when errors cleared after prior blocks", () => {
			expect.assertions(1);

			const result = stopDecision({
				errorFiles: [],
				lintAttempts: {},
				maxLintAttempts: 1,
				stopAttempts: 2,
			});

			expect(result).toStrictEqual({ resetStopAttempts: true });
		});

		it("should not increment stop attempts when no errors and counter is 0", () => {
			expect.assertions(1);

			const result = stopDecision({
				errorFiles: [],
				lintAttempts: {},
				maxLintAttempts: 1,
				stopAttempts: 0,
			});

			expect(result).toBeUndefined();
		});

		it("should block when errors exist and attempts below max", () => {
			expect.assertions(5);

			const result = stopDecision({
				errorFiles: ["src/foo.ts"],
				lintAttempts: {},
				maxLintAttempts: 1,
				stopAttempts: 0,
			});

			expect(result?.decision).toBe("block");
			expect(result?.reason).toContain("src/foo.ts");
			expect(result?.reason).toContain('<workspace_diagnostics source="eslint">');
			expect(result?.reason).toMatch(/\?\s*\n?<\/workspace_diagnostics>/);
			expect(result?.reason).not.toMatch(/\byou\b/i);
		});

		it("should allow stop when all erroring files maxed out", () => {
			expect.assertions(1);

			const result = stopDecision({
				errorFiles: ["src/foo.ts"],
				lintAttempts: { "src/foo.ts": 3 },
				maxLintAttempts: 1,
				stopAttempts: 0,
			});

			expect(result).toBeUndefined();
		});

		it("should match attempts by basename when paths differ", () => {
			expect.assertions(1);

			const result = stopDecision({
				errorFiles: ["src/foo.ts"],
				lintAttempts: { "D:/projects/skills/src/foo.ts": 3 },
				maxLintAttempts: 1,
				stopAttempts: 0,
			});

			expect(result).toBeUndefined();
		});

		it("should match when paths differ only by separator", () => {
			expect.assertions(1);

			const result = stopDecision({
				errorFiles: ["src\\foo.ts"],
				lintAttempts: { "src/foo.ts": 3 },
				maxLintAttempts: 1,
				stopAttempts: 0,
			});

			expect(result).toBeUndefined();
		});

		it("should not false-match different files sharing a suffix", () => {
			expect.assertions(1);

			const result = stopDecision({
				errorFiles: ["foo.ts"],
				lintAttempts: { "b/foo.ts": 3 },
				maxLintAttempts: 1,
				stopAttempts: 0,
			});

			expect(result).toMatchObject({ decision: "block" });
		});

		it("should allow stop after 3 stop attempts with informational reason", () => {
			expect.assertions(4);

			const result = stopDecision({
				errorFiles: ["src/foo.ts"],
				lintAttempts: {},
				maxLintAttempts: 1,
				stopAttempts: 3,
			});

			expect(result?.decision).toBeUndefined();
			expect(result?.reason).toContain("Unresolved lint issues");
			expect(result?.reason).toContain('<workspace_diagnostics source="eslint">');
			expect(result?.reason).not.toMatch(/\byou\b/i);
		});
	});

	describe(isProtectedFile, () => {
		it("should block eslint flat config files", () => {
			expect.assertions(1);

			expect(isProtectedFile("eslint.config.mjs")).toBe(true);
		});

		it("should block legacy eslintrc files", () => {
			expect.assertions(4);

			expect(isProtectedFile(".eslintrc")).toBe(true);
			expect(isProtectedFile(".eslintrc.js")).toBe(true);
			expect(isProtectedFile(".eslintrc.json")).toBe(true);
			expect(isProtectedFile(".eslintrc.yaml")).toBe(true);
		});

		it("should block oxlint config files", () => {
			expect.assertions(2);

			expect(isProtectedFile("oxlint.config.ts")).toBe(true);
			expect(isProtectedFile(".oxlintrc.json")).toBe(true);
		});

		it("should approve normal source files", () => {
			expect.assertions(1);

			expect(isProtectedFile("src/index.ts")).toBe(false);
		});

		it("should approve files with eslint in path but not filename", () => {
			expect.assertions(1);

			expect(isProtectedFile("eslint-plugin/index.ts")).toBe(false);
		});
	});

	describe(getBucketKey, () => {
		it("should return <session_id>:main when agent_id is absent", () => {
			expect.assertions(1);

			const input = {
				cwd: "/project",
				session_id: "abc123",
				transcript_path: "/tmp/t.json",
			} satisfies BaseHookInput;

			expect(getBucketKey(input)).toBe("abc123:main");
		});

		it("should return <session_id>:<agent_id> when agent_id is present", () => {
			expect.assertions(1);

			const input = {
				agent_id: "agent_xyz",
				cwd: "/project",
				session_id: "abc123",
				transcript_path: "/tmp/t.json",
			} satisfies BaseHookInput;

			expect(getBucketKey(input)).toBe("abc123:agent_xyz");
		});
	});

	describe(narrowToolInput, () => {
		it("should return file_path for valid Edit input", () => {
			expect.assertions(1);

			const result = narrowToolInput({
				tool_input: { file_path: "/project/src/foo.ts" },
				tool_name: "Edit",
			});

			expect(result.file_path).toBe("/project/src/foo.ts");
		});

		it("should return file_path for valid Write input", () => {
			expect.assertions(1);

			const result = narrowToolInput({
				tool_input: { content: "x", file_path: "/project/src/bar.ts" },
				tool_name: "Write",
			});

			expect(result.file_path).toBe("/project/src/bar.ts");
		});

		it("should throw when tool_input is not an object", () => {
			expect.assertions(1);

			expect(() => {
				narrowToolInput({ tool_input: "not-an-object", tool_name: "Edit" });
			}).toThrowError(TypeError);
		});

		it("should throw when tool_input is null", () => {
			expect.assertions(1);

			expect(() => {
				narrowToolInput({ tool_input: null, tool_name: "Edit" });
			}).toThrowError(TypeError);
		});

		it("should throw when file_path is missing", () => {
			expect.assertions(1);

			expect(() => {
				narrowToolInput({ tool_input: { content: "x" }, tool_name: "Write" });
			}).toThrowError(TypeError);
		});

		it("should throw when file_path is empty", () => {
			expect.assertions(1);

			expect(() => {
				narrowToolInput({ tool_input: { file_path: "" }, tool_name: "Edit" });
			}).toThrowError(TypeError);
		});

		it("should throw when file_path is not a string", () => {
			expect.assertions(1);

			expect(() => {
				narrowToolInput({ tool_input: { file_path: 123 }, tool_name: "Edit" });
			}).toThrowError(TypeError);
		});
	});

	describe(readEditedFiles, () => {
		it("should return empty array when file missing", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(readEditedFiles("abc123:main")).toStrictEqual([]);
		});

		it("should return files for the given bucket", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:agent_xyz": { edited: ["src/bar.ts"], lastSurfacedAt: null },
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			expect(readEditedFiles("abc123:main")).toStrictEqual(["src/foo.ts"]);
		});

		it("should return empty array for unknown bucket", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			expect(readEditedFiles("zzz:main")).toStrictEqual([]);
		});

		it("should return empty array on corrupt JSON", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("{bad json");

			expect(readEditedFiles("abc123:main")).toStrictEqual([]);
		});
	});

	describe(writeEditedFile, () => {
		it("should create state file with bucket entry", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			writeEditedFile("abc123:main", "src/foo.ts");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);
		});

		it("should append to existing bucket entry", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			writeEditedFile("abc123:main", "src/bar.ts");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts", "src/bar.ts"], lastSurfacedAt: null },
				}),
			);
		});

		it("should deduplicate files within a bucket", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			writeEditedFile("abc123:main", "src/foo.ts");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);
		});

		it("should not interfere with sibling buckets in the same session", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			writeEditedFile("abc123:agent_xyz", "src/bar.ts");

			const lastCall = mockedWriteFileSync.mock.lastCall!;
			const writtenState = JSON.parse(lastCall[1] as string) as Record<string, unknown>;

			expect(writtenState).toStrictEqual({
				"abc123:agent_xyz": { edited: ["src/bar.ts"], lastSurfacedAt: null },
				"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
			});
		});

		it("should preserve lastSurfacedAt across writes", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: 1000 },
				}),
			);

			writeEditedFile("abc123:main", "src/bar.ts");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts", "src/bar.ts"], lastSurfacedAt: 1000 },
				}),
			);
		});
	});

	describe("composite-key isolation", () => {
		it("should not leak edits between main and subagent buckets", () => {
			expect.assertions(2);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:agent_xyz": { edited: ["src/bar.ts"], lastSurfacedAt: null },
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			expect(readEditedFiles("abc123:main")).toStrictEqual(["src/foo.ts"]);
			expect(readEditedFiles("abc123:agent_xyz")).toStrictEqual(["src/bar.ts"]);
		});

		it("should round-trip writes to two buckets via mocked file", () => {
			expect.assertions(2);

			let stored = "{}";
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/edited-files.json",
			);
			mockedReadFileSync.mockImplementation(() => stored);
			mockedWriteFileSync.mockImplementation((_path, content) => {
				stored = content as string;
			});

			writeEditedFile("abc123:main", "src/foo.ts");
			writeEditedFile("abc123:agent_xyz", "src/bar.ts");

			expect(readEditedFiles("abc123:main")).toStrictEqual(["src/foo.ts"]);
			expect(readEditedFiles("abc123:agent_xyz")).toStrictEqual(["src/bar.ts"]);
		});
	});

	describe(markBucketSurfaced, () => {
		it("should clear edited and set lastSurfacedAt on existing bucket", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			markBucketSurfaced("abc123:main", 12_345);

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc123:main": { edited: [], lastSurfacedAt: 12_345 },
				}),
			);
		});

		it("should create empty bucket when none exists", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			markBucketSurfaced("abc123:main", 12_345);

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc123:main": { edited: [], lastSurfacedAt: 12_345 },
				}),
			);
		});
	});

	describe(getLastSurfacedAt, () => {
		it("should return null when bucket missing", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(getLastSurfacedAt("abc123:main")).toBeNull();
		});

		it("should return stored timestamp", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: [], lastSurfacedAt: 9999 },
				}),
			);

			expect(getLastSurfacedAt("abc123:main")).toBe(9999);
		});
	});

	describe(clearEditedFiles, () => {
		it("should no-op when file missing", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockReturnValue(false);

			clearEditedFiles("abc123:main");

			expect(mockedUnlinkSync).not.toHaveBeenCalled();
		});

		it("should delete file when bucket is the only entry", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			clearEditedFiles("abc123:main");

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".claude/state/edited-files.json");
		});

		it("should keep file with remaining buckets", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:agent_xyz": { edited: ["src/bar.ts"], lastSurfacedAt: null },
					"abc123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			clearEditedFiles("abc123:main");

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc123:agent_xyz": { edited: ["src/bar.ts"], lastSurfacedAt: null },
				}),
			);
		});

		it("should delete file on corrupt JSON", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("{bad");

			clearEditedFiles("abc123:main");

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".claude/state/edited-files.json");
		});
	});

	describe(registerSession, () => {
		it("should write the pid into the sessions directory", () => {
			expect.assertions(2);

			mockedMkdirSync.mockClear();
			mockedWriteFileSync.mockClear();

			registerSession("abc123", "12345");

			expect(mockedMkdirSync).toHaveBeenCalledWith(".claude/state/sessions", {
				recursive: true,
			});
			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				join(".claude/state/sessions", "abc123"),
				"12345",
			);
		});
	});

	describe(loadLiveSessions, () => {
		it("should return empty set when sessions directory missing", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(loadLiveSessions()).toStrictEqual(new Set());
		});

		it("should include sessions whose pid is alive", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			vi.mocked(readdirSync).mockReturnValue(["abc123", "def456"] as never);
			mockedReadFileSync.mockImplementation((path) => {
				return path === join(".claude/state/sessions", "abc123") ? "111" : "222";
			});
			const killSpy = vi.spyOn(process, "kill").mockReturnValue(true);

			try {
				expect(loadLiveSessions()).toStrictEqual(new Set(["abc123", "def456"]));
			} finally {
				killSpy.mockRestore();
			}
		});

		it("should drop and unlink sessions whose pid is dead", () => {
			expect.assertions(2);

			mockedExistsSync.mockReturnValue(true);
			mockedUnlinkSync.mockClear();
			vi.mocked(readdirSync).mockReturnValue(["abc123", "dead-session"] as never);
			mockedReadFileSync.mockImplementation((path) => {
				return path === join(".claude/state/sessions", "abc123") ? "111" : "999";
			});
			const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
				if (pid === 999) {
					throw new Error("ESRCH");
				}

				return true;
			});

			try {
				const live = loadLiveSessions();

				expect(live).toStrictEqual(new Set(["abc123"]));
				expect(mockedUnlinkSync).toHaveBeenCalledWith(
					join(".claude/state/sessions", "dead-session"),
				);
			} finally {
				killSpy.mockRestore();
			}
		});

		it("should drop entries whose contents are not numeric", () => {
			expect.assertions(2);

			mockedExistsSync.mockReturnValue(true);
			mockedUnlinkSync.mockClear();
			vi.mocked(readdirSync).mockReturnValue(["malformed"] as never);
			mockedReadFileSync.mockReturnValue("not-a-pid");

			const live = loadLiveSessions();

			expect(live).toStrictEqual(new Set());
			expect(mockedUnlinkSync).toHaveBeenCalledWith(
				join(".claude/state/sessions", "malformed"),
			);
		});
	});

	describe(pruneDeadSessions, () => {
		it("should drop dead sessions from lint-attempts (sessionId-keyed)", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/lint-attempts.json",
			);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"dead-session": { "src/baz.ts": 1 },
					"live123": { "src/foo.ts": 2 },
				}),
			);

			pruneDeadSessions(new Set(["live123"]));

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/lint-attempts.json",
				JSON.stringify({ live123: { "src/foo.ts": 2 } }),
			);
		});

		it("should drop dead sessions from stop-attempts (bucketKey-keyed)", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/stop-attempts.json",
			);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"dead-session:main": 5,
					"live123:agent_xyz": 1,
					"live123:main": 2,
				}),
			);

			pruneDeadSessions(new Set(["live123"]));

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/stop-attempts.json",
				JSON.stringify({ "live123:agent_xyz": 1, "live123:main": 2 }),
			);
		});

		it("should drop dead sessions from edited-files (bucketKey-keyed)", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/edited-files.json",
			);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"dead-session:main": { edited: ["src/baz.ts"], lastSurfacedAt: null },
					"live123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			pruneDeadSessions(new Set(["live123"]));

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"live123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);
		});

		it("should unlink files when no entries survive", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/lint-attempts.json",
			);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({ "dead-session": { "src/foo.ts": 1 } }),
			);

			pruneDeadSessions(new Set());

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".claude/state/lint-attempts.json");
		});

		it("should no-op when every entry belongs to a live session", () => {
			expect.assertions(2);

			mockedUnlinkSync.mockClear();
			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/edited-files.json",
			);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"live123:agent_xyz": { edited: ["src/bar.ts"], lastSurfacedAt: null },
					"live123:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			pruneDeadSessions(new Set(["live123"]));

			expect(mockedUnlinkSync).not.toHaveBeenCalled();
			expect(mockedWriteFileSync).not.toHaveBeenCalled();
		});

		it("should unlink files with corrupt JSON", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/lint-attempts.json",
			);
			mockedReadFileSync.mockReturnValue("{bad");

			pruneDeadSessions(new Set(["live123"]));

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".claude/state/lint-attempts.json");
		});

		it("should not match a session id that is a prefix of a longer one", () => {
			expect.assertions(1);

			mockedWriteFileSync.mockClear();
			mockedExistsSync.mockImplementation(
				(path) => path === ".claude/state/edited-files.json",
			);
			mockedReadFileSync.mockReturnValue(
				JSON.stringify({
					"abc123:main": { edited: ["src/bar.ts"], lastSurfacedAt: null },
					"abc:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);

			pruneDeadSessions(new Set(["abc"]));

			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/edited-files.json",
				JSON.stringify({
					"abc:main": { edited: ["src/foo.ts"], lastSurfacedAt: null },
				}),
			);
		});
	});

	describe(getTransitiveDependents, () => {
		it("should return empty when no entry points found", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(getTransitiveDependents(["src/foo.ts"], "/project/src")).toStrictEqual([]);
		});

		it("should return direct importers", () => {
			expect.assertions(1);

			const sourceRoot = resolve("/project/src");
			const existing = new Set([join(sourceRoot, "index.ts")]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));
			mockedExecSync.mockReturnValue(
				JSON.stringify({
					"bar.ts": ["foo.ts"],
					"foo.ts": [],
					"index.ts": ["bar.ts"],
				}),
			);

			const result = getTransitiveDependents([join(sourceRoot, "foo.ts")], sourceRoot);

			expect(result).toStrictEqual([
				join(sourceRoot, "bar.ts"),
				join(sourceRoot, "index.ts"),
			]);
		});

		it("should not include the original files in results", () => {
			expect.assertions(1);

			const sourceRoot = resolve("/project/src");
			const existing = new Set([join(sourceRoot, "index.ts")]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));
			mockedExecSync.mockReturnValue(
				JSON.stringify({
					"bar.ts": ["foo.ts"],
					"foo.ts": [],
				}),
			);

			const result = getTransitiveDependents([join(sourceRoot, "foo.ts")], sourceRoot);

			expect(result).toStrictEqual([join(sourceRoot, "bar.ts")]);
		});
	});
});
