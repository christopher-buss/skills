import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const HOOK_PATH = resolve("hooks/lint-guard.ts");

function runGuard(filePath: string, projectDirectory?: string): string {
	const input = JSON.stringify({ tool_input: { file_path: filePath }, tool_name: "Edit" });
	const result = spawnSync("node", [HOOK_PATH], {
		cwd: projectDirectory,
		encoding: "utf-8",
		env: { ...process.env, CLAUDE_PROJECT_DIR: projectDirectory ?? "" },
		input,
	});
	return result.stdout.trim();
}

function makeProject(allow: string): string {
	const root = mkdtempSync(join(tmpdir(), "lint-guard-"));
	mkdirSync(join(root, ".claude"), { recursive: true });
	writeFileSync(
		join(root, ".claude", "sentinel.local.md"),
		`---\nlint-guard-allow: ${allow}\n---\n`,
	);
	return root;
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

	it("should allow a config covered by lint-guard-allow", () => {
		expect.assertions(1);

		const root = makeProject("packages/app/eslint.config.ts");

		const output = runGuard(join(root, "packages", "app", "eslint.config.ts"), root);

		expect(output).toBe("");
	});

	it("should still block a config outside lint-guard-allow", () => {
		expect.assertions(1);

		const root = makeProject("packages/app/eslint.config.ts");

		const output = runGuard(join(root, "packages", "lib", "eslint.config.ts"), root);
		const parsed = JSON.parse(output) as { decision: string };

		expect(parsed.decision).toBe("block");
	});

	it("should block edits to the sentinel settings file", () => {
		expect.assertions(1);

		const root = makeProject("packages/app/eslint.config.ts");

		const output = runGuard(join(root, ".claude", "sentinel.local.md"), root);
		const parsed = JSON.parse(output) as { decision: string };

		expect(parsed.decision).toBe("block");
	});
});
