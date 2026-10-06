import { describe, expect, it } from "vitest";

import { errorReason, failedReason, missingCliReason } from "../src/messages.ts";

describe("reasons", () => {
	it("should say to install with the package manager", () => {
		expect.assertions(1);

		expect(missingCliReason("/r", "pnpm install")).toBe(
			"commitlint-preflight: /r configures commitlint but @commitlint/cli is not installed, so the PR title cannot be checked. Run `pnpm install` in /r, then the same command.",
		);
	});

	it("should show commitlint output and say to fix the title", () => {
		expect.assertions(1);

		expect(failedReason("bad", "out")).toBe(
			'commitlint-preflight: commitlint rejects the PR title "bad" (a squash merge makes it the commit message):\nout\nFix the title as that output says (e.g. shorten it to the limit it names), and keep the rest of the command.',
		);
	});

	it("should give the error and a manual check", () => {
		expect.assertions(3);

		expect(errorReason("feat: it's", new Error("timed out"))).toBe(
			"commitlint-preflight: commitlint did not run on the PR title \"feat: it's\": timed out\nRetry the command, or check the title by hand: printf '%s\\n' 'feat: it'\\''s' | npx commitlint",
		);
		expect(errorReason("t", "boom")).toMatch(
			/"t": boom\n.*printf '%s\\n' t \| npx commitlint$/u,
		);
		expect(errorReason(undefined, "boom")).toMatch(
			/on the PR title: boom\n.*printf '%s\\n' '<title>' \|/u,
		);
	});
});
