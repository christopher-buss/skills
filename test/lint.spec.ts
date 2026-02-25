import { join, resolve } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

import {
	buildHookOutput,
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
	readSettings,
	restartDaemon,
	runEslint,
	runOxlint,
} from "../scripts/lint.js";

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
			const deps = { existsSync: (path: string) => existing.has(path) };

			expect(findSourceRoot(join("/project", "src", "foo.ts"), deps)).toBe(sourceDirectory);
		});

		it("should return project root when no src/ directory", () => {
			expect.assertions(1);

			const existing = new Set([packageJson]);
			const deps = { existsSync: (path: string) => existing.has(path) };

			expect(findSourceRoot(join("/project", "lib", "foo.ts"), deps)).toBe(join("/project"));
		});

		it("should walk up directories to find package.json", () => {
			expect.assertions(1);

			const existing = new Set([packageJson, sourceDirectory]);
			const deps = { existsSync: (path: string) => existing.has(path) };

			expect(findSourceRoot(join("/project", "src", "deep", "nested", "foo.ts"), deps)).toBe(
				join("/project", "src"),
			);
		});

		it("should return undefined when no package.json found", () => {
			expect.assertions(1);

			const deps = { existsSync: () => false };

			expect(findSourceRoot(join("/project", "src", "foo.ts"), deps)).toBeUndefined();
		});
	});

	describe(findEntryPoints, () => {
		it("should return only candidates that exist on disk", () => {
			expect.assertions(1);

			const sourceRoot = join("/project", "src");
			const existing = new Set([join(sourceRoot, "index.ts")]);
			const deps = { existsSync: (path: string) => existing.has(path) };

			expect(findEntryPoints(sourceRoot, deps)).toStrictEqual([join(sourceRoot, "index.ts")]);
		});

		it("should return empty array when no candidates exist", () => {
			expect.assertions(1);

			const deps = { existsSync: () => false };

			expect(findEntryPoints(join("/project", "src"), deps)).toStrictEqual([]);
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
			let capturedCommand = "";

			const deps = {
				execSync(command: string) {
					capturedCommand = command;
					return JSON.stringify(expectedGraph);
				},
			};

			const result = getDependencyGraph("/src", ["/src/index.ts"], deps);

			expect(capturedCommand).toBe('pnpm exec madge --json "/src/index.ts"');
			expect(result).toStrictEqual(expectedGraph);
		});
	});

	const testFilePath = "/project/src/foo.ts";
	const testErrorLine = "  1:5  error  no-unused-vars";

	describe(invalidateCacheEntries, () => {
		it("should be no-op for empty file list", () => {
			expect.assertions(1);

			const deps = {
				createCache: () => ({ reconcile: () => {}, removeEntry: () => {} }),
				existsSync: () => true,
			};

			// Should not throw
			invalidateCacheEntries([], deps);

			expect(true).toBe(true);
		});

		it("should be no-op when cache file does not exist", () => {
			expect.assertions(1);

			const deps = {
				createCache: () => ({ reconcile: () => {}, removeEntry: () => {} }),
				existsSync: () => false,
			};

			invalidateCacheEntries([testFilePath], deps);

			expect(true).toBe(true);
		});

		it("should remove entries and reconcile cache", () => {
			expect.assertions(2);

			const removed: Array<string> = [];
			let isReconciled = false;

			const deps = {
				createCache: () => {
					return {
						reconcile() {
							isReconciled = true;
						},
						removeEntry(key: string) {
							removed.push(key);
						},
					};
				},
				existsSync: () => true,
			};

			invalidateCacheEntries(["/project/src/a.ts", "/project/src/b.ts"], deps);

			expect(removed).toStrictEqual(["/project/src/a.ts", "/project/src/b.ts"]);
			expect(isReconciled).toBe(true);
		});
	});

	describe(runEslint, () => {
		it("should run eslint_d with correct args and ESLINT_IN_EDITOR env", () => {
			expect.assertions(2);

			let capturedCommand = "";
			let capturedEnvironment = {} as Record<string, string>;

			const deps = {
				execSync(command: string, options?: { env?: Record<string, string> }) {
					capturedCommand = command;
					capturedEnvironment = options?.env ?? {};
					return "";
				},
			};

			runEslint(testFilePath, deps);

			expect(capturedCommand).toBe(`pnpm exec eslint_d --cache "${testFilePath}"`);
			expect(capturedEnvironment).toMatchObject({ ESLINT_IN_EDITOR: "true" });
		});

		it("should capture stdout/stderr/message on error", () => {
			expect.assertions(1);

			const deps = {
				execSync() {
					const error = new Error("Command failed") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from(`${testErrorLine}\n`);
					error.stderr = Buffer.from("");
					throw error;
				},
			};

			const result = runEslint(testFilePath, deps);

			expect(result).toContain("no-unused-vars");
		});

		it("should fall back to stderr when stdout is empty", () => {
			expect.assertions(1);

			const deps = {
				execSync() {
					const error = new Error("fail") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from("");
					error.stderr = Buffer.from("stderr output");
					throw error;
				},
			};

			expect(runEslint(testFilePath, deps)).toBe("stderr output");
		});

		it("should fall back to message when error has no stdout/stderr properties", () => {
			expect.assertions(1);

			const deps = {
				execSync() {
					throw new Error("plain error");
				},
			};

			expect(runEslint(testFilePath, deps)).toBe("plain error");
		});

		it("should return empty string when error has no properties", () => {
			expect.assertions(1);

			const deps = {
				execSync() {
					// eslint-disable-next-line ts/only-throw-error -- testing edge case
					throw { stderr: Buffer.from(""), stdout: Buffer.from("") };
				},
			};

			expect(runEslint(testFilePath, deps)).toBe("");
		});

		it("should fall back to message when stdout and stderr are empty", () => {
			expect.assertions(1);

			const deps = {
				execSync() {
					const error = new Error("error message") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from("");
					error.stderr = Buffer.from("");
					throw error;
				},
			};

			expect(runEslint(testFilePath, deps)).toBe("error message");
		});
	});

	describe(restartDaemon, () => {
		it("should spawn detached eslint_d restart and swallow errors", () => {
			expect.assertions(2);

			let capturedCommand = "";
			let capturedArgs: Array<string> = [];

			const self = {
				on(_event: string, handler: () => void) {
					handler();
					return self;
				},
				unref: () => {},
			};
			const deps = {
				spawn(command: string, args: Array<string>) {
					capturedCommand = command;
					capturedArgs = args;
					return self;
				},
			};

			restartDaemon(deps);

			expect(capturedCommand).toBe("pnpm");
			expect(capturedArgs).toStrictEqual(["exec", "eslint_d", "restart"]);
		});

		it("should swallow spawn errors", () => {
			expect.assertions(1);

			const deps = {
				spawn() {
					throw new Error("spawn failed");
				},
			};

			restartDaemon(deps);

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

			const deps = { execSync: () => "" };

			expect(getChangedFiles(deps)).toStrictEqual([]);
		});

		it("should parse git diff and untracked files into file list", () => {
			expect.assertions(1);

			const deps = {
				execSync(command: string): string {
					if (command.includes("git diff")) {
						return "src/foo.ts\nsrc/bar.ts\n";
					}

					if (command.includes("ls-files")) {
						return "src/new.ts\n";
					}

					return "";
				},
			};

			expect(getChangedFiles(deps)).toStrictEqual(["src/foo.ts", "src/bar.ts", "src/new.ts"]);
		});
	});

	describe(readSettings, () => {
		it("should return defaults when no file exists", () => {
			expect.assertions(1);

			const deps = { existsSync: () => false, readFileSync: () => "" };

			expect(readSettings(deps)).toStrictEqual({
				cacheBust: [],
				eslint: true,
				lint: true,
				oxlint: false,
				runner: "pnpm exec",
			});
		});

		it("should return defaults when file has no frontmatter", () => {
			expect.assertions(1);

			const deps = { existsSync: () => true, readFileSync: () => "no frontmatter here" };

			expect(readSettings(deps)).toStrictEqual({
				cacheBust: [],
				eslint: true,
				lint: true,
				oxlint: false,
				runner: "pnpm exec",
			});
		});

		it("should skip malformed lines in frontmatter", () => {
			expect.assertions(1);

			const content = '---\nno-colon-line\noxlint: "true"\n---\n';
			const deps = { existsSync: () => true, readFileSync: () => content };

			expect(readSettings(deps)).toMatchObject({ oxlint: true });
		});

		it("should parse eslint and oxlint flags from frontmatter", () => {
			expect.assertions(1);

			const content = '---\nlint: "true"\neslint: "false"\noxlint: "true"\n---\n';
			const deps = { existsSync: () => true, readFileSync: () => content };

			expect(readSettings(deps)).toStrictEqual({
				cacheBust: [],
				eslint: false,
				lint: true,
				oxlint: true,
				runner: "pnpm exec",
			});
		});
	});

	describe(runOxlint, () => {
		it("should run oxlint with correct command", () => {
			expect.assertions(1);

			let capturedCommand = "";
			const deps = {
				execSync(command: string) {
					capturedCommand = command;
					return "";
				},
			};

			runOxlint("/project/src/foo.ts", deps);

			expect(capturedCommand).toBe('pnpm exec oxlint "/project/src/foo.ts"');
		});

		it("should pass extra flags", () => {
			expect.assertions(1);

			let capturedCommand = "";
			const deps = {
				execSync(command: string) {
					capturedCommand = command;
					return "";
				},
			};

			runOxlint("/project/src/foo.ts", deps, ["--fix"]);

			expect(capturedCommand).toBe('pnpm exec oxlint --fix "/project/src/foo.ts"');
		});

		it("should capture error output", () => {
			expect.assertions(1);

			const deps = {
				execSync() {
					const error = new Error("fail") as Error & {
						stderr: Buffer;
						stdout: Buffer;
					};
					error.stdout = Buffer.from("  1:5  error  no-unused-vars\n");
					error.stderr = Buffer.from("");
					throw error;
				},
			};

			expect(runOxlint("/project/src/foo.ts", deps)).toContain("no-unused-vars");
		});

		it("should return undefined on success", () => {
			expect.assertions(1);

			const deps = { execSync: () => "" };

			expect(runOxlint("/project/src/foo.ts", deps)).toBeUndefined();
		});

		it("should return empty string when error has no properties", () => {
			expect.assertions(1);

			const deps = {
				execSync() {
					// eslint-disable-next-line ts/only-throw-error -- testing edge case
					throw { stderr: Buffer.from(""), stdout: Buffer.from("") };
				},
			};

			expect(runOxlint("/project/src/foo.ts", deps)).toBe("");
		});
	});

	describe(main, () => {
		const spawnResult = { on: () => spawnResult, unref: () => {} };
		const baseDeps = {
			createCache: () => ({ reconcile: () => {}, removeEntry: () => {} }),
			execSync: () => "",
			existsSync: () => false,
			spawn: () => spawnResult,
		};

		it("should invalidate cache for changed files before linting", () => {
			expect.assertions(1);

			vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			vi.spyOn(process.stderr, "write").mockReturnValue(true);

			const removed: Array<string> = [];

			const deps = {
				...baseDeps,
				createCache: () => {
					return {
						reconcile: () => {},
						removeEntry(key: string) {
							removed.push(key);
						},
					};
				},
				execSync(command: string): string {
					if (command.includes("git diff")) {
						return "src/changed.ts\n";
					}

					return "";
				},
				existsSync: () => true,
			};

			main(["."], deps);

			expect(removed).toContain("src/changed.ts");

			vi.restoreAllMocks();
		});

		it("should exit cleanly when no errors", () => {
			expect.assertions(2);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

			main(["."], baseDeps);

			expect(exitSpy).not.toHaveBeenCalled();
			expect(stderrSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it("should exit 1 when eslint fails", () => {
			expect.assertions(1);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);

			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("eslint_d")) {
						throw new Error("lint failed");
					}

					return "";
				},
				spawn: () => spawnResult,
			};

			main(["."], deps);

			expect(exitSpy).toHaveBeenCalledWith(1);

			vi.restoreAllMocks();
		});

		it("should not write to stderr when output is only config noise", () => {
			expect.assertions(1);

			vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

			const deps = {
				...baseDeps,
				execSync(command: string): string {
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
				},
				spawn: () => spawnResult,
			};

			main(["."], deps);

			expect(stderrSpy).not.toHaveBeenCalled();

			vi.restoreAllMocks();
		});

		it("should filter config noise from output", () => {
			expect.assertions(2);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

			const noisy = "[@config] some noise\nsrc/foo.ts\n  1:5  error  bad\n";
			const deps = {
				...baseDeps,
				execSync(command: string): string {
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
				},
				spawn: () => spawnResult,
			};

			main(["."], deps);

			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(stderrSpy).toHaveBeenCalledWith(expect.not.stringContaining("@config"));

			vi.restoreAllMocks();
		});

		it("should exit 1 when oxlint fails", () => {
			expect.assertions(1);

			const exitSpy = vi.spyOn(process, "exit").mockReturnValue(undefined as never);
			vi.spyOn(process.stderr, "write").mockReturnValue(true);

			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("oxlint")) {
						throw new Error("oxlint error");
					}

					return "";
				},
			};

			main(["."], deps, {
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

			let didRunOxlint = false;
			let didRunEslint = false;
			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("oxlint")) {
						didRunOxlint = true;
					}

					if (command.includes("eslint_d")) {
						didRunEslint = true;
					}

					return "";
				},
			};

			main(["."], deps, {
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
		const spawnResult = { on: () => spawnResult, unref: () => {} };
		const baseDeps = {
			createCache: () => ({ reconcile: () => {}, removeEntry: () => {} }),
			execSync: () => "",
			existsSync: () => false,
			spawn: () => spawnResult,
		};

		it("should skip non-lintable files with early exit", () => {
			expect.assertions(1);

			const result = lint("readme.txt", baseDeps);

			expect(result).toBeUndefined();
		});

		it("should return undefined when eslint output has no error lines", () => {
			expect.assertions(1);

			const deps = {
				...baseDeps,
				execSync(command: string): string {
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
				},
				spawn() {
					return spawnResult;
				},
			};

			const result = lint(join("/project", "src", "foo.ts"), deps);

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

			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("eslint_d")) {
						didRunEslint = true;
					}

					if (command.includes("madge")) {
						return '{"app.ts":["foo.ts"]}';
					}

					return "";
				},
				existsSync: (path: string) => existing.has(path),
				spawn() {
					didRestartDaemon = true;
					return spawnResult;
				},
			};

			lint(join("/project", "src", "foo.ts"), deps);

			expect(didRunEslint).toBe(true);
			expect(didRestartDaemon).toBe(true);
		});

		it("should skip importers when no entry points found", () => {
			expect.assertions(1);

			const existing = new Set([
				join(resolve("/project"), "package.json"),
				resolve("/project", "src"),
			]);

			const deps = {
				...baseDeps,
				existsSync: (path: string) => existing.has(path),
			};

			const result = lint(join("/project", "src", "foo.ts"), deps);

			expect(result).toBeUndefined();
		});

		it("should gracefully handle madge failure in importer resolution", () => {
			expect.assertions(1);

			const projectSource = resolve("/project", "src");
			const existing = new Set([
				join(projectSource, "index.ts"),
				join(resolve("/project"), "package.json"),
				projectSource,
			]);

			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("madge")) {
						throw new Error("madge not found");
					}

					return "";
				},
				existsSync: (path: string) => existing.has(path),
			};

			const result = lint(join("/project", "src", "foo.ts"), deps);

			expect(result).toBeUndefined();
		});

		it("should return formatted hook output on lint failure", () => {
			expect.assertions(1);

			const deps = {
				...baseDeps,
				execSync(command: string): string {
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
				},
				spawn() {
					return spawnResult;
				},
			};

			const result = lint(join("/project", "src", "foo.ts"), deps);

			expect(result).toMatchObject({
				hookSpecificOutput: {
					hookEventName: "PostToolUse",
				},
			});
		});

		it("should return errors from oxlint when enabled", () => {
			expect.assertions(1);

			const deps = {
				...baseDeps,
				execSync(command: string): string {
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
				},
				spawn: () => spawnResult,
			};

			const result = lint(join("/project", "src", "foo.ts"), deps, [], {
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

			let didRunOxlint = false;
			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("oxlint")) {
						didRunOxlint = true;
					}

					return "";
				},
				spawn: () => spawnResult,
			};

			lint(join("/project", "src", "foo.ts"), deps);

			expect(didRunOxlint).toBe(false);
		});

		it("should run oxlint when enabled in settings", () => {
			expect.assertions(1);

			let didRunOxlint = false;
			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("oxlint")) {
						didRunOxlint = true;
					}

					return "";
				},
				spawn: () => spawnResult,
			};

			lint(join("/project", "src", "foo.ts"), deps, [], {
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
			const deps = {
				...baseDeps,
				execSync(command: string): string {
					if (command.includes("eslint_d")) {
						didRunEslint = true;
					}

					return "";
				},
				spawn() {
					didRestartDaemon = true;
					return spawnResult;
				},
			};

			lint(join("/project", "src", "foo.ts"), deps, [], {
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
		it("should parse cacheBust into array", () => {
			expect.assertions(1);

			const content = "---\ncache-bust: eslint.config.ts, tsconfig.json\n---\n";
			const deps = { existsSync: () => true, readFileSync: () => content };

			expect(readSettings(deps)).toMatchObject({
				cacheBust: ["eslint.config.ts", "tsconfig.json"],
			});
		});

		it.todo("should default cacheBust to empty array");
	});

	describe("readSettings runner", () => {
		it("should parse runner from frontmatter", () => {
			expect.assertions(1);

			const content = "---\nrunner: npx\n---\n";
			const deps = { existsSync: () => true, readFileSync: () => content };

			expect(readSettings(deps)).toMatchObject({ runner: "npx" });
		});

		it("should default runner to pnpm exec", () => {
			expect.assertions(1);

			const content = "---\neslint: true\n---\n";
			const deps = { existsSync: () => true, readFileSync: () => content };

			expect(readSettings(deps)).toMatchObject({ runner: "pnpm exec" });
		});

		it("should strip quotes from runner value", () => {
			expect.assertions(1);

			const content = '---\nrunner: "yarn dlx"\n---\n';
			const deps = { existsSync: () => true, readFileSync: () => content };

			expect(readSettings(deps)).toMatchObject({ runner: "yarn dlx" });
		});
	});

	describe("custom runner commands", () => {
		it("should use custom runner in eslint command", () => {
			expect.assertions(1);

			let capturedCommand = "";
			const deps = {
				execSync(command: string) {
					capturedCommand = command;
					return "";
				},
			};

			runEslint(testFilePath, deps, [], "npx");

			expect(capturedCommand).toBe(`npx eslint_d --cache "${testFilePath}"`);
		});

		it("should use custom runner in oxlint command", () => {
			expect.assertions(1);

			let capturedCommand = "";
			const deps = {
				execSync(command: string) {
					capturedCommand = command;
					return "";
				},
			};

			runOxlint(testFilePath, deps, [], "npx");

			expect(capturedCommand).toBe(`npx oxlint "${testFilePath}"`);
		});

		it("should split multi-word runner for spawn in restartDaemon", () => {
			expect.assertions(2);

			let capturedCommand = "";
			let capturedArgs: Array<string> = [];
			const self = {
				on() {
					return self;
				},
				unref: () => {},
			};
			const deps = {
				spawn(command: string, args: Array<string>) {
					capturedCommand = command;
					capturedArgs = args;
					return self;
				},
			};

			restartDaemon(deps, "yarn dlx");

			expect(capturedCommand).toBe("yarn");
			expect(capturedArgs).toStrictEqual(["dlx", "eslint_d", "restart"]);
		});

		it("should handle single-word runner for spawn", () => {
			expect.assertions(2);

			let capturedCommand = "";
			let capturedArgs: Array<string> = [];
			const self = {
				on() {
					return self;
				},
				unref: () => {},
			};
			const deps = {
				spawn(command: string, args: Array<string>) {
					capturedCommand = command;
					capturedArgs = args;
					return self;
				},
			};

			restartDaemon(deps, "npx");

			expect(capturedCommand).toBe("npx");
			expect(capturedArgs).toStrictEqual(["eslint_d", "restart"]);
		});

		it("should use custom runner in getDependencyGraph", () => {
			expect.assertions(1);

			let capturedCommand = "";
			const deps = {
				execSync(command: string) {
					capturedCommand = command;
					return "{}";
				},
			};

			getDependencyGraph("/src", ["/src/index.ts"], deps, "npx");

			expect(capturedCommand).toBe('npx madge --json "/src/index.ts"');
		});
	});

	describe("shouldBustCache", () => {
		it.todo("should return true when bust file newer than cache");

		it.todo("should return false when cache newer than bust file");

		it.todo("should return false when cache does not exist");
	});

	describe("clearCache", () => {
		it.todo("should delete cache file");

		it.todo("should no-op when cache missing");
	});

	describe("cache busting integration", () => {
		it.todo("should clear full cache in lint when bust triggered");

		it.todo("should clear full cache in main when bust triggered");
	});
});
