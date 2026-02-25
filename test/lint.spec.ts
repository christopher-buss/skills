import { createFromFile } from "file-entry-cache";
import type { ChildProcess } from "node:child_process";
import { execSync, spawn } from "node:child_process";
import {
	existsSync,
	globSync,
	mkdirSync,
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
	clearLintAttempts,
	DEFAULT_CACHE_BUST,
	findEntryPoints,
	findSourceRoot,
	formatErrors,
	getChangedFiles,
	getDependencyGraph,
	invalidateCacheEntries,
	invertGraph,
	isLintableFile,
	lint,
	main,
	readLintAttempts,
	readSettings,
	resolveBustFiles,
	restartDaemon,
	runEslint,
	runOxlint,
	shouldBustCache,
	writeLintAttempts,
} from "../scripts/lint.js";

function fromPartial<T>(mock: PartialDeep<NoInfer<T>>): T {
	return mock as T;
}

vi.mock(import("node:child_process"), async () => {
	return fromPartial({
		execSync: vi.fn<typeof execSync>(),
		spawn: vi.fn<typeof spawn>(),
	});
});

vi.mock(import("node:fs"), async () => {
	return fromPartial({
		existsSync: vi.fn<typeof existsSync>(() => false),
		globSync: vi.fn<typeof globSync>(() => []),
		mkdirSync: vi.fn<typeof mkdirSync>(),
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
	const self = fromPartial<ChildProcess>({
		on(_event: string, handler: () => void) {
			handler();
			return self;
		},
		unref: () => {},
	});
	return self;
}

describe(lint, () => {
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
		it("should run eslint_d with correct args and ESLINT_IN_EDITOR env", () => {
			expect.assertions(2);

			mockedExecSync.mockClear();
			mockedExecSync.mockReturnValue("");

			runEslint(testFilePath);

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

			const result = runEslint(testFilePath);

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

			expect(runEslint(testFilePath)).toBe("stderr output");
		});

		it("should fall back to message when error has no stdout/stderr properties", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation(() => {
				throw new Error("plain error");
			});

			expect(runEslint(testFilePath)).toBe("plain error");
		});

		it("should return empty string when error has no properties", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation(() => {
				// eslint-disable-next-line ts/only-throw-error -- testing edge case
				throw { stderr: Buffer.from(""), stdout: Buffer.from("") };
			});

			expect(runEslint(testFilePath)).toBe("");
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

			expect(runEslint(testFilePath)).toBe("error message");
		});
	});

	describe(restartDaemon, () => {
		it("should spawn detached eslint_d restart and swallow errors", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());

			restartDaemon();

			expect(mockedSpawn).toHaveBeenCalledWith(
				"pnpm",
				["exec", "eslint_d", "restart"],
				expect.objectContaining({ detached: true }),
			);
		});

		it("should swallow spawn errors", () => {
			expect.assertions(1);

			mockedSpawn.mockImplementation(() => {
				throw new Error("spawn failed");
			});

			restartDaemon();

			expect(true).toBe(true);
		});
	});

	describe(formatErrors, () => {
		it("should extract error lines from eslint output", () => {
			expect.assertions(1);

			const output = `${testErrorLine}\n  2:1  warning  no-console\n`;

			expect(formatErrors(output)).toStrictEqual([testErrorLine]);
		});

		it("should truncate to 5 errors max", () => {
			expect.assertions(1);

			const lines = Array.from(
				{ length: 10 },
				(_, index) => `  ${index}:1  error  rule-${index}`,
			);
			const output = lines.join("\n");

			const result = formatErrors(output);

			expect(result).toHaveLength(5);
		});
	});

	describe(buildHookOutput, () => {
		it("should return correct hook JSON shape", () => {
			expect.assertions(3);

			const result = buildHookOutput("foo.ts", [testErrorLine]);

			expect(result).toMatchObject({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
				},
			});
			expect(result.systemMessage).toContain("foo.ts");
			expect(result.hookSpecificOutput.additionalContext).toContain("foo.ts");
		});

		it("should truncate output when errors reach max", () => {
			expect.assertions(2);

			const errors = Array.from(
				{ length: 5 },
				(_, index) => `  ${index}:1  error  rule-${index}`,
			);
			const result = buildHookOutput("foo.ts", errors);

			expect(result.systemMessage).toContain("...");
			expect(result.hookSpecificOutput.additionalContext).toContain("run lint to view more");
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
	});

	describe(readSettings, () => {
		it("should return defaults when no file exists", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(readSettings()).toStrictEqual({
				cacheBust: [...DEFAULT_CACHE_BUST],
				eslint: true,
				lint: true,
				maxLintAttempts: 3,
				oxlint: false,
				runner: "pnpm exec",
			});
		});

		it("should return defaults when file has no frontmatter", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("no frontmatter here");

			expect(readSettings()).toStrictEqual({
				cacheBust: [...DEFAULT_CACHE_BUST],
				eslint: true,
				lint: true,
				maxLintAttempts: 3,
				oxlint: false,
				runner: "pnpm exec",
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
				eslint: false,
				lint: true,
				maxLintAttempts: 3,
				oxlint: true,
				runner: "pnpm exec",
			});
		});
	});

	describe(runOxlint, () => {
		it("should run oxlint with correct command", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runOxlint("/project/src/foo.ts");

			expect(mockedExecSync).toHaveBeenCalledWith(
				'pnpm exec oxlint "/project/src/foo.ts"',
				expect.anything(),
			);
		});

		it("should pass extra flags", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runOxlint("/project/src/foo.ts", ["--fix"]);

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

			expect(runOxlint("/project/src/foo.ts")).toContain("no-unused-vars");
		});

		it("should return undefined on success", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			expect(runOxlint("/project/src/foo.ts")).toBeUndefined();
		});

		it("should return empty string when error has no properties", () => {
			expect.assertions(1);

			mockedExecSync.mockImplementation(() => {
				// eslint-disable-next-line ts/only-throw-error -- testing edge case
				throw { stderr: Buffer.from(""), stdout: Buffer.from("") };
			});

			expect(runOxlint("/project/src/foo.ts")).toBe("");
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
				eslint: false,
				lint: true,
				oxlint: true,
				runner: "pnpm exec",
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
				eslint: false,
				lint: true,
				oxlint: true,
				runner: "pnpm exec",
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
			mockedSpawn.mockImplementation(() => {
				didRestartDaemon = true;
				return fakeSpawnResult();
			});

			lint(join("/project", "src", "foo.ts"));

			expect(didRunEslint).toBe(true);
			expect(didRestartDaemon).toBe(true);
		});

		it("should skip importers when no entry points found", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());
			const existing = new Set([
				join(resolve("/project"), "package.json"),
				resolve("/project", "src"),
			]);
			mockedExistsSync.mockImplementation((path) => existing.has(path as string));
			mockedExecSync.mockReturnValue("");

			const result = lint(join("/project", "src", "foo.ts"));

			expect(result).toBeUndefined();
		});

		it("should gracefully handle madge failure in importer resolution", () => {
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

			const result = lint(join("/project", "src", "foo.ts"));

			expect(result).toBeUndefined();
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
				eslint: false,
				lint: true,
				oxlint: true,
				runner: "pnpm exec",
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
				eslint: true,
				lint: true,
				oxlint: true,
				runner: "pnpm exec",
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
				eslint: false,
				lint: true,
				oxlint: false,
				runner: "pnpm exec",
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

		it("should default maxLintAttempts to 3", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("---\neslint: true\n---\n");

			expect(readSettings()).toMatchObject({ maxLintAttempts: 3 });
		});
	});

	describe("custom runner commands", () => {
		it("should use custom runner in eslint command", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runEslint(testFilePath, [], "npx");

			expect(mockedExecSync).toHaveBeenCalledWith(
				`npx eslint_d --cache "${testFilePath}"`,
				expect.anything(),
			);
		});

		it("should use custom runner in oxlint command", () => {
			expect.assertions(1);

			mockedExecSync.mockReturnValue("");

			runOxlint(testFilePath, [], "npx");

			expect(mockedExecSync).toHaveBeenCalledWith(
				`npx oxlint "${testFilePath}"`,
				expect.anything(),
			);
		});

		it("should split multi-word runner for spawn in restartDaemon", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());

			restartDaemon("yarn dlx");

			expect(mockedSpawn).toHaveBeenLastCalledWith(
				"yarn",
				["dlx", "eslint_d", "restart"],
				expect.anything(),
			);
		});

		it("should handle single-word runner for spawn", () => {
			expect.assertions(1);

			mockedSpawn.mockReturnValue(fakeSpawnResult());

			restartDaemon("npx");

			expect(mockedSpawn).toHaveBeenLastCalledWith(
				"npx",
				["eslint_d", "restart"],
				expect.anything(),
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
				eslint: true,
				lint: true,
				oxlint: false,
				runner: "pnpm exec",
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
				eslint: true,
				lint: true,
				oxlint: false,
				runner: "pnpm exec",
			});

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".eslintcache");

			vi.restoreAllMocks();
		});
	});

	describe(readLintAttempts, () => {
		it("should return empty object when file missing", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(false);

			expect(readLintAttempts()).toStrictEqual({});
		});

		it("should parse valid JSON", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue('{"src/foo.ts":2}');

			expect(readLintAttempts()).toStrictEqual({ "src/foo.ts": 2 });
		});

		it("should return empty object on corrupt JSON", () => {
			expect.assertions(1);

			mockedExistsSync.mockReturnValue(true);
			mockedReadFileSync.mockReturnValue("{bad json");

			expect(readLintAttempts()).toStrictEqual({});
		});
	});

	describe(writeLintAttempts, () => {
		it("should create dir and write JSON", () => {
			expect.assertions(2);

			mockedMkdirSync.mockClear();
			mockedWriteFileSync.mockClear();

			writeLintAttempts({ "src/foo.ts": 2 });

			expect(mockedMkdirSync).toHaveBeenCalledWith(".claude/state", { recursive: true });
			expect(mockedWriteFileSync).toHaveBeenCalledWith(
				".claude/state/lint-attempts.json",
				'{"src/foo.ts":2}',
			);
		});
	});

	describe(clearLintAttempts, () => {
		it("should delete file when exists", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockReturnValue(true);

			clearLintAttempts();

			expect(mockedUnlinkSync).toHaveBeenCalledWith(".claude/state/lint-attempts.json");
		});

		it("should no-op when file missing", () => {
			expect.assertions(1);

			mockedUnlinkSync.mockClear();
			mockedExistsSync.mockReturnValue(false);

			clearLintAttempts();

			expect(mockedUnlinkSync).not.toHaveBeenCalled();
		});
	});
});
