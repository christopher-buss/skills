import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildHookOutput,
	findEntryPoints,
	findSourceRoot,
	formatErrors,
	getDependencyGraph,
	invalidateCacheEntries,
	invertGraph,
	isLintableFile,
	lint,
	restartDaemon,
	runEslint,
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

			expect(capturedCommand).toBe('pnpm madge --json "/src/index.ts"');
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
			let capturedEnvironment: Record<string, string> = {};

			const deps = {
				execSync(command: string, options?: { env?: Record<string, string> }) {
					capturedCommand = command;
					capturedEnvironment = options?.env ?? {};
					return "";
				},
			};

			runEslint(testFilePath, deps);

			expect(capturedCommand).toBe(
				`pnpm exec eslint_d --cache --max-warnings 0 --fix "${testFilePath}"`,
			);
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
			expect(capturedArgs).toStrictEqual(["eslint_d", "restart"]);
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
	});
});
