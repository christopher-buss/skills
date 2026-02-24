import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findSourceRoot, isHookInput, isLintableFile } from "../scripts/lint.js";

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
		it("should return src/ when package.json and src/ both exist", () => {
			expect.assertions(1);

			const existing = new Set([join("/project", "package.json"), join("/project", "src")]);
			const deps = { existsSync: (path: string) => existing.has(path) };

			expect(findSourceRoot(join("/project", "src", "foo.ts"), deps)).toBe(
				join("/project", "src"),
			);
		});

		it.todo("should return project root when no src/ directory");

		it.todo("should walk up directories to find package.json");

		it.todo("should return undefined when no package.json found");
	});

	describe("findEntryPoints", () => {
		it.todo("should return only candidates that exist on disk");

		it.todo("should return empty array when no candidates exist");
	});

	describe("invertGraph", () => {
		it.todo("should find single importer of target file");

		it.todo("should return empty array when no importers");

		it.todo("should find multiple importers of target file");
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
