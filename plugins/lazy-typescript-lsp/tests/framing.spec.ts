import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import { createReader, encodeMessage, type Message } from "../src/framing.ts";

function frame(body: string): Buffer {
	return Buffer.concat([
		Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`, "ascii"),
		Buffer.from(body, "utf8"),
	]);
}

function createHarness() {
	const onError = vi.fn<(problem: string) => void>();
	const onMessage = vi.fn<(message: Message) => void>();
	return { onError, onMessage, read: createReader({ onError, onMessage }) };
}

describe(encodeMessage, () => {
	it("should frame the body with its byte length", () => {
		expect.assertions(1);

		expect(encodeMessage({ jsonrpc: "2.0", method: "é" }).toString("utf8")).toBe(
			'Content-Length: 31\r\n\r\n{"jsonrpc":"2.0","method":"é"}',
		);
	});
});

describe(createReader, () => {
	it("should read messages split across chunks and joined in one chunk", () => {
		expect.assertions(1);

		const { onMessage, read } = createHarness();
		const first = encodeMessage({ id: 1, jsonrpc: "2.0", method: "hover" });
		read(first.subarray(0, 10));
		read(first.subarray(10, 30));
		read(
			Buffer.concat([
				first.subarray(30),
				encodeMessage({ id: 1, jsonrpc: "2.0", result: null }),
			]),
		);

		expect(onMessage.mock.calls).toStrictEqual([
			[{ id: 1, jsonrpc: "2.0", method: "hover" }],
			[{ id: 1, jsonrpc: "2.0", result: null }],
		]);
	});

	it("should accept a null id", () => {
		expect.assertions(1);

		const { onMessage, read } = createHarness();
		read(frame('{"jsonrpc":"2.0","id":null,"error":{}}'));

		expect(onMessage).toHaveBeenCalledWith({ id: null, error: {}, jsonrpc: "2.0" });
	});

	it("should keep fields the schema does not name", () => {
		expect.assertions(1);

		const { onMessage, read } = createHarness();
		read(frame('{"jsonrpc":"2.0","method":"x","extra":true}'));

		expect(onMessage).toHaveBeenCalledWith({ extra: true, jsonrpc: "2.0", method: "x" });
	});

	it.for([
		["Content-Type: x\r\n\r\n", "no Content-Length header"],
		["Content-Length: 3\r\n\r\n{x}", "is not JSON"],
		["Content-Length: 2\r\n\r\n{}", "is not JSON-RPC 2.0"],
		['Content-Length: 25\r\n\r\n{"jsonrpc":"2.0","id":[]}', "is not JSON-RPC 2.0"],
		['Content-Length: 28\r\n\r\n{"jsonrpc":"2.0","method":1}', "is not JSON-RPC 2.0"],
	] as const)("should report %j and read on", ([input, problem]) => {
		expect.assertions(2);

		const { onError, onMessage, read } = createHarness();
		read(
			Buffer.concat([
				Buffer.from(input, "ascii"),
				encodeMessage({ jsonrpc: "2.0", method: "ok" }),
			]),
		);

		expect(onError).toHaveBeenCalledWith(expect.stringContaining(problem));
		expect(onMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", method: "ok" });
	});

	it("should report a non-Error throw from the parser", () => {
		expect.assertions(1);

		vi.spyOn(JSON, "parse").mockImplementationOnce(() => {
			// eslint-disable-next-line ts/only-throw-error -- the case under test
			throw "bad";
		});
		const { onError, read } = createHarness();
		read(frame("{}"));

		expect(onError).toHaveBeenCalledWith("an LSP message is not JSON: bad");
	});
});
