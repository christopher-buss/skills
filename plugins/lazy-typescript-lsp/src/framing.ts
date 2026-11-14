import { Buffer } from "node:buffer";

import { type Fields, isFields, isRequestId } from "./guards.ts";

const CONTENT_LENGTH = /^content-length:\s*(\d+)\s*$/im;
const HEADER_END = Buffer.from("\r\n\r\n", "ascii");
const LOGGED_BODY_LENGTH = 200;

export interface Message extends Fields {
	id?: null | number | string;
	error?: unknown;
	jsonrpc: "2.0";
	method?: string;
	params?: unknown;
	result?: unknown;
}

export interface ReaderEvents {
	onError: (problem: string) => void;
	onMessage: (message: Message) => void;
}

export function encodeMessage(message: Message): Buffer {
	const body = Buffer.from(JSON.stringify(message), "utf8");
	return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

export function createReader(events: ReaderEvents): (chunk: Buffer) => void {
	let buffer: Buffer = Buffer.alloc(0);

	return (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		let rest = readFrame(buffer, events);
		while (rest !== undefined) {
			buffer = rest;
			rest = readFrame(buffer, events);
		}
	};
}

function isMessage(value: unknown): value is Message {
	if (!isFields(value) || value["jsonrpc"] !== "2.0") {
		return false;
	}

	const { id, method } = value;
	return (
		(id === undefined || id === null || isRequestId(id)) &&
		(method === undefined || typeof method === "string")
	);
}

function readBody(body: string, { onError, onMessage }: ReaderEvents): void {
	let message: unknown;
	try {
		message = JSON.parse(body);
	} catch (err) {
		onError(`an LSP message is not JSON: ${err instanceof Error ? err.message : String(err)}`);
		return;
	}

	if (!isMessage(message)) {
		onError(`an LSP message is not JSON-RPC 2.0: ${body.slice(0, LOGGED_BODY_LENGTH)}`);
		return;
	}

	onMessage(message);
}

function readFrame(buffer: Buffer, events: ReaderEvents): Buffer | undefined {
	const headerEnd = buffer.indexOf(HEADER_END);
	if (headerEnd === -1) {
		return undefined;
	}

	const bodyStart = headerEnd + HEADER_END.length;
	const length = CONTENT_LENGTH.exec(buffer.subarray(0, headerEnd).toString("ascii"))?.[1];
	if (length === undefined) {
		events.onError("an LSP message has no Content-Length header");
		return buffer.subarray(bodyStart);
	}

	const bodyEnd = bodyStart + Number(length);
	if (buffer.length < bodyEnd) {
		return undefined;
	}

	readBody(buffer.subarray(bodyStart, bodyEnd).toString("utf8"), events);
	return buffer.subarray(bodyEnd);
}
