import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isHookInput } from "../hooks/lint.js";
import { findEntryPoints, findSourceRoot, invertGraph, isLintableFile } from "../scripts/lint.js";

describe("lint", () => {
	describe(isHookInput, () => {
		it("should return true for valid input with tool_input.file_path", () => {
			expect.assertions(1);

			const input = { tool_input: { file_path: "src/index.ts" } };

			expect(isHookInput(input)).toBe(true);
		});

		it("should return false for null", () => {
			expect.assertions(1);

			expect(isHookInput(null)).toBe(false);
		});

		it("should return false when tool_input is missing", () => {
			expect.assertions(1);

			expect(isHookInput({ other: "field" })).toBe(false);
		});

		it("should return false when file_path is missing from tool_input", () => {
			expect.assertions(1);

			expect(isHookInput({ tool_input: { other: "field" } })).toBe(false);
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

	describe("getDependencyGraph", () => {
		it.todo("should call execSync with correct madge command and parse JSON");
	});

	describe("invalidateCacheEntries", () => {
		it.todo("should be no-op for empty file list");

		it.todo("should be no-op when cache file does not exist");

		it.todo("should remove entries and reconcile cache");
	});

	describe("runEslint", () => {
		it.todo("should run eslint_d with correct args and ESLINT_IN_EDITOR env");

		it.todo("should capture stdout/stderr/message on error");
	});

	describe("restartDaemon", () => {
		it.todo("should spawn detached eslint_d restart and swallow errors");
	});

	describe("formatErrors", () => {
		it.todo("should extract error lines from eslint output");

		it.todo("should truncate to 5 errors max");
	});

	describe("buildHookOutput", () => {
		it.todo("should return correct hook JSON shape");
	});

	describe("lint (orchestrator)", () => {
		it.todo("should skip non-lintable files with early exit");

		it.todo("should run full pipeline: importers → invalidate → eslint → restart");

		it.todo("should return formatted hook output on lint failure");
	});
});
