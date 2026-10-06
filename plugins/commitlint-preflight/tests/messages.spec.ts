import { describe, expect, it } from "vitest";

import { errorReason, failedReason, missingCliReason } from "../src/messages.ts";

describe("reasons", () => {
	it("should name the title, root, and output", () => {
		expect.assertions(4);

		expect(missingCliReason("/r")).toMatch(/\/r .*Install dependencies/u);
		expect(failedReason("bad", "out")).toMatch(/"bad"[\s\S]*\nout$/u);
		expect(errorReason("t", new Error("timed out"))).toMatch(/"t": timed out$/u);
		expect(errorReason("t", "boom")).toMatch(/"t": boom$/u);
	});
});
