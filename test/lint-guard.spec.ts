import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runGuard(filePath: string): string {
	const input = JSON.stringify({ tool_input: { file_path: filePath }, tool_name: "Edit" });
	const result = spawnSync("node", ["hooks/lint-guard.ts"], {
		encoding: "utf-8",
		input,
	});
	return result.stdout.trim();
}

describe("lint-guard hook", () => {
	it("should block edits to eslint config", () => {
		expect.assertions(2);

		const output = runGuard("eslint.config.mjs");
		const parsed = JSON.parse(output) as { decision: string; reason: string };

		expect(parsed.decision).toBe("block");
		expect(parsed.reason).toContain("linter config");
	});

	it("should block edits to oxlint config", () => {
		expect.assertions(1);

		const output = runGuard("oxlint.config.ts");
		const parsed = JSON.parse(output) as { decision: string; reason: string };

		expect(parsed.decision).toBe("block");
	});

	it("should output nothing for normal files", () => {
		expect.assertions(1);

		const output = runGuard("src/foo.ts");

		expect(output).toBe("");
	});

	it("should check basename not full path", () => {
		expect.assertions(1);

		const output = runGuard("eslint-plugin/index.ts");

		expect(output).toBe("");
	});
});
