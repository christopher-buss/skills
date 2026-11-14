import { type Fields, isFields, isInteger, isNaturalNumber } from "./guards.ts";

const SYNC_METHODS = new Set([
	"textDocument/didChange",
	"textDocument/didClose",
	"textDocument/didOpen",
]);

export interface OpenDocument {
	languageId: string;
	text: string;
	uri: string;
	version: number;
}

interface Position {
	character: number;
	line: number;
}

interface ContentChange {
	range?: { end: Position; start: Position };
	text: string;
}

type DocumentFields = Fields & { uri: string };

export function isDocumentSync(method: string): boolean {
	return SYNC_METHODS.has(method);
}

export function trackDocument(
	documents: Map<string, OpenDocument>,
	{ method, params }: { method: string; params: unknown },
): string | undefined {
	const { contentChanges, textDocument } = isFields(params) ? params : {};
	if (!hasUri(textDocument)) {
		return "textDocument.uri must be a string";
	}

	if (method === "textDocument/didOpen") {
		return openDocument(documents, textDocument);
	}

	if (method === "textDocument/didClose") {
		documents.delete(textDocument.uri);
		return undefined;
	}

	return changeDocument(documents, { contentChanges, textDocument });
}

function hasUri(value: unknown): value is DocumentFields {
	return isFields(value) && typeof value["uri"] === "string";
}

function openDocument(
	documents: Map<string, OpenDocument>,
	{ languageId, text, uri, version }: DocumentFields,
): string | undefined {
	if (typeof languageId !== "string" || typeof text !== "string" || !isInteger(version)) {
		return "textDocument needs a string languageId and text and an integer version";
	}

	documents.set(uri, { languageId, text, uri, version });
	return undefined;
}

function isPosition(value: unknown): value is Position {
	return isFields(value) && isNaturalNumber(value["character"]) && isNaturalNumber(value["line"]);
}

function isContentChange(value: unknown): value is ContentChange {
	if (!isFields(value) || typeof value["text"] !== "string") {
		return false;
	}

	const { range } = value;
	return (
		range === undefined ||
		(isFields(range) && isPosition(range["start"]) && isPosition(range["end"]))
	);
}

function offsetAt(text: string, { character, line }: Position): number {
	let lineStart = 0;
	for (let current = 0; current < line; current += 1) {
		const newline = text.indexOf("\n", lineStart);
		if (newline === -1) {
			return text.length;
		}

		lineStart = newline + 1;
	}

	const newline = text.indexOf("\n", lineStart);
	const lineEnd = newline === -1 ? text.length : newline;
	return Math.min(lineStart + character, lineEnd);
}

function changeDocument(
	documents: Map<string, OpenDocument>,
	{ contentChanges, textDocument }: { contentChanges: unknown; textDocument: DocumentFields },
): string | undefined {
	const { uri, version } = textDocument;
	if (
		!isInteger(version) ||
		!Array.isArray(contentChanges) ||
		!contentChanges.every(isContentChange)
	) {
		return "textDocument needs an integer version and contentChanges must hold text edits";
	}

	const document = documents.get(uri);
	if (document === undefined) {
		return `${uri} changed but is not open`;
	}

	for (const { range, text } of contentChanges) {
		document.text =
			range === undefined
				? text
				: document.text.slice(0, offsetAt(document.text, range.start)) +
					text +
					document.text.slice(offsetAt(document.text, range.end));
	}

	document.version = version;
	return undefined;
}
