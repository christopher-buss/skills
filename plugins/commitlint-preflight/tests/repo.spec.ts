import { describe, expect, it } from "vitest";

import {
	ancestors,
	binEntry,
	COMMITLINT_CONFIG_FILES,
	hasCommitlintKey,
	join,
} from "../src/repo.ts";

describe(ancestors, () => {
	it.for<[string, Array<string>]>([
		["D:\\a\\b", ["D:/a/b", "D:/a", "D:/"]],
		["D:/a/b/", ["D:/a/b", "D:/a", "D:/"]],
		["/home/u", ["/home/u", "/home", "/"]],
	])("should list %j and its parents nearest first", ([directory, expected]) => {
		expect.assertions(1);

		expect(ancestors(directory)).toStrictEqual(expected);
	});
});

describe(join, () => {
	it.for<[string, string, string]>([
		["D:/", ".git", "D:/.git"],
		["/r", "./cli.js", "/r/cli.js"],
	])("should join %j and %j", ([directory, path, expected]) => {
		expect.assertions(1);

		expect(join(directory, path)).toBe(expected);
	});
});

describe("commitlint config files", () => {
	it("should hold the standard config names", () => {
		expect.assertions(1);

		expect(COMMITLINT_CONFIG_FILES).toStrictEqual([
			".commitlintrc",
			".commitlintrc.json",
			".commitlintrc.yaml",
			".commitlintrc.yml",
			".commitlintrc.js",
			".commitlintrc.cjs",
			".commitlintrc.mjs",
			".commitlintrc.ts",
			".commitlintrc.cts",
			".commitlintrc.mts",
			"commitlint.config.js",
			"commitlint.config.cjs",
			"commitlint.config.mjs",
			"commitlint.config.ts",
			"commitlint.config.cts",
			"commitlint.config.mts",
		]);
	});
});

describe(hasCommitlintKey, () => {
	it.for<[string, boolean]>([
		['{"commitlint":{"extends":[]}}', true],
		['{"name":"x"}', false],
		["null", false],
		["not json", false],
	])("should read %j as %j", ([text, expected]) => {
		expect.assertions(1);

		expect(hasCommitlintKey(text)).toBe(expected);
	});
});

describe(binEntry, () => {
	it.for<[string, string | undefined]>([
		['{"bin":"./cli.js"}', "./cli.js"],
		['{"bin":{"commitlint":"./cli.js"}}', "./cli.js"],
		['{"bin":{"other":"./x.js"}}', undefined],
		['{"bin":{"commitlint":1}}', undefined],
		['{"bin":null}', undefined],
		["{}", undefined],
		["", undefined],
	])("should resolve the bin of %j", ([text, expected]) => {
		expect.assertions(1);

		expect(binEntry(text)).toBe(expected);
	});
});
