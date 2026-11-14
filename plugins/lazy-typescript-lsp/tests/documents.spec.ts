import { describe, expect, it } from "vitest";

import { isDocumentSync, type OpenDocument, trackDocument } from "../src/documents.ts";

const URI = "file:///a.ts";

function openDocuments(text: string): Map<string, OpenDocument> {
	const documents = new Map<string, OpenDocument>();
	trackDocument(documents, {
		method: "textDocument/didOpen",
		params: { textDocument: { languageId: "typescript", text, uri: URI, version: 1 } },
	});
	return documents;
}

function change(
	documents: Map<string, OpenDocument>,
	contentChanges: Array<unknown>,
): string | undefined {
	return trackDocument(documents, {
		method: "textDocument/didChange",
		params: { contentChanges, textDocument: { uri: URI, version: 2 } },
	});
}

function range(start: [number, number], end: [number, number]) {
	return {
		end: { character: end[1], line: end[0] },
		start: { character: start[1], line: start[0] },
	};
}

describe(isDocumentSync, () => {
	it.for([
		["textDocument/didOpen", true],
		["textDocument/didChange", true],
		["textDocument/didClose", true],
		["textDocument/didSave", false],
	] as const)("should classify %s", ([method, isSync]) => {
		expect.assertions(1);

		expect(isDocumentSync(method)).toBe(isSync);
	});
});

describe(trackDocument, () => {
	it("should store an opened document", () => {
		expect.assertions(1);

		expect(openDocuments("a").get(URI)).toStrictEqual({
			languageId: "typescript",
			text: "a",
			uri: URI,
			version: 1,
		});
	});

	it("should replace the text on a full change", () => {
		expect.assertions(2);

		const documents = openDocuments("old");

		expect(change(documents, [{ text: "new" }])).toBeUndefined();
		expect(documents.get(URI)).toMatchObject({ text: "new", version: 2 });
	});

	it("should apply range changes in order", () => {
		expect.assertions(1);

		const documents = openDocuments("one\ntwo\nthree");
		change(documents, [
			{ range: range([1, 0], [1, 3]), text: "2" },
			{ range: range([0, 3], [1, 0]), text: " " },
		]);

		expect(documents.get(URI)!.text).toBe("one 2\nthree");
	});

	it("should clamp positions past the line or the text", () => {
		expect.assertions(1);

		const documents = openDocuments("ab\ncd");
		change(documents, [
			{ range: range([0, 9], [0, 9]), text: "!" },
			{ range: range([7, 0], [7, 0]), text: "?" },
			{ range: range([1, 9], [1, 9]), text: "#" },
		]);

		expect(documents.get(URI)!.text).toBe("ab!\ncd?#");
	});

	it("should forget a closed document", () => {
		expect.assertions(2);

		const documents = openDocuments("a");

		expect(
			trackDocument(documents, {
				method: "textDocument/didClose",
				params: { textDocument: { uri: URI } },
			}),
		).toBeUndefined();
		expect(documents.size).toBe(0);
	});

	it("should report a change to a document that is not open", () => {
		expect.assertions(1);

		expect(change(new Map(), [{ text: "x" }])).toBe(`${URI} changed but is not open`);
	});

	it("should report params that are not an object", () => {
		expect.assertions(1);

		expect(
			trackDocument(new Map(), { method: "textDocument/didOpen", params: null }),
		).toContain("textDocument");
	});

	it("should report an opened document without text", () => {
		expect.assertions(1);

		expect(
			trackDocument(new Map(), {
				method: "textDocument/didOpen",
				params: { textDocument: { uri: URI } },
			}),
		).toContain("languageId");
	});

	it.for([
		["text", [{ range: range([0, 0], [0, 0]) }]],
		["range", [{ range: { start: { character: 0, line: 0 } }, text: "" }]],
		["position", [{ range: range([0, -1], [0, 0]), text: "" }]],
		["array", { text: "" }],
	] as const)("should report a change with a bad %s", ([, contentChanges]) => {
		expect.assertions(1);

		expect(
			trackDocument(openDocuments("a"), {
				method: "textDocument/didChange",
				params: { contentChanges, textDocument: { uri: URI, version: 2 } },
			}),
		).toContain("contentChanges");
	});

	it.for(["textDocument/didOpen", "textDocument/didChange", "textDocument/didClose"])(
		"should report bad %s params",
		(method) => {
			expect.assertions(1);

			expect(trackDocument(new Map(), { method, params: {} })).toContain("textDocument");
		},
	);
});
