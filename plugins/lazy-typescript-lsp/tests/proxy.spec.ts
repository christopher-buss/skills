import { describe, expect, it, type Mock, vi } from "vitest";

import type { Message } from "../src/framing.ts";
import { type InitializeResult, LazyLspProxy, type ServerHandle } from "../src/proxy.ts";

const CAPABILITIES = { hover: {} };
const RESULT = { capabilities: { hoverProvider: true } };
const INITIALIZE_ID = "lazy-lsp:initialize";
const URI = "file:///a.ts";

interface FakeServer extends ServerHandle {
	sent: Array<Message>;
	stop: Mock<() => void>;
}

function createHarness({ cached = true }: { cached?: boolean } = {}) {
	const servers: Array<FakeServer> = [];
	const toClient: Array<Message> = [];
	const timers: Array<{ callback: () => void; cancel: Mock<() => void> }> = [];
	const ports = {
		exit: vi.fn<() => void>(),
		idleStop: 1000,
		log: vi.fn<(problem: string) => void>(),
		readInitializeResult: vi.fn<(capabilitiesKey: string) => typeof RESULT | undefined>(() => {
			return cached ? RESULT : undefined;
		}),
		schedule: (callback: () => void) => {
			const cancel = vi.fn<() => void>();
			timers.push({ callback, cancel });
			return cancel;
		},
		sendToClient: (message: Message) => {
			toClient.push(message);
		},
		startServer: () => {
			const sent: Array<Message> = [];
			const fake = {
				send: (message) => {
					sent.push(message);
				},
				sent,
				stop: vi.fn<() => void>(),
			} satisfies FakeServer;
			servers.push(fake);
			return fake;
		},
		writeInitializeResult: vi.fn<(capabilitiesKey: string, result: InitializeResult) => void>(),
	};
	const proxy = new LazyLspProxy(ports);
	function client(message: Partial<Message>): void {
		proxy.fromClient({ jsonrpc: "2.0", ...message });
	}

	function server(index: number): FakeServer {
		return servers[index]!;
	}

	function answerInitialize(index: number, response: Partial<Message>): void {
		proxy.fromServer(server(index), { id: INITIALIZE_ID, jsonrpc: "2.0", ...response });
	}

	function lastTimer() {
		return timers.at(-1)!;
	}

	client({
		id: 0,
		method: "initialize",
		params: { capabilities: CAPABILITIES, rootUri: "file:///" },
	});
	return { answerInitialize, client, lastTimer, ports, proxy, server, servers, timers, toClient };
}

function startRunning() {
	const harness = createHarness();
	harness.client({ method: "initialized", params: {} });
	harness.client({ id: 1, method: "textDocument/hover", params: {} });
	harness.answerInitialize(0, { result: RESULT });
	return harness;
}

describe(LazyLspProxy, () => {
	it("should answer initialize from the cache and start no server", () => {
		expect.assertions(3);

		const { client, ports, servers, toClient } = createHarness();
		client({ id: "s1", result: null });
		client({ method: "initialized", params: {} });
		client({
			method: "textDocument/didOpen",
			params: { textDocument: { languageId: "typescript", text: "a", uri: URI, version: 1 } },
		});

		expect(ports.readInitializeResult).toHaveBeenCalledWith(JSON.stringify(CAPABILITIES));
		expect(toClient).toStrictEqual([{ id: 0, jsonrpc: "2.0", result: RESULT }]);
		expect(servers).toHaveLength(0);
	});

	it("should start the server on the first request and replay the session", () => {
		expect.assertions(2);

		const { answerInitialize, client, server } = createHarness();
		client({ method: "initialized", params: {} });
		client({
			method: "textDocument/didOpen",
			params: { textDocument: { languageId: "typescript", text: "a", uri: URI, version: 1 } },
		});
		client({ id: 1, method: "textDocument/hover", params: { position: 1 } });
		client({
			method: "textDocument/didChange",
			params: { contentChanges: [{ text: "b" }], textDocument: { uri: URI, version: 2 } },
		});

		expect(server(0).sent).toStrictEqual([
			{
				id: INITIALIZE_ID,
				jsonrpc: "2.0",
				method: "initialize",
				params: { capabilities: CAPABILITIES, rootUri: "file:///" },
			},
		]);

		answerInitialize(0, { result: RESULT });

		expect(server(0).sent.slice(1)).toStrictEqual([
			{ jsonrpc: "2.0", method: "initialized", params: {} },
			{
				jsonrpc: "2.0",
				method: "textDocument/didOpen",
				params: {
					textDocument: { languageId: "typescript", text: "b", uri: URI, version: 2 },
				},
			},
			{ id: 1, jsonrpc: "2.0", method: "textDocument/hover", params: { position: 1 } },
		]);
	});

	it("should forward traffic while running and stop when idle", () => {
		expect.assertions(5);

		const { client, lastTimer, proxy, server, timers, toClient } = startRunning();
		toClient.length = 0;
		proxy.fromServer(server(0), { id: 1, jsonrpc: "2.0", result: "hover" });
		proxy.fromServer(server(0), { id: 99, jsonrpc: "2.0", result: "stray" });
		proxy.fromServer(server(0), {
			jsonrpc: "2.0",
			method: "textDocument/publishDiagnostics",
			params: {},
		});
		client({ method: "textDocument/didSave", params: {} });
		client({ id: 2, method: "textDocument/definition", params: {} });

		expect(toClient).toStrictEqual([
			{ id: 1, jsonrpc: "2.0", result: "hover" },
			{ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {} },
		]);
		expect(timers[0]!.cancel).toHaveBeenCalledOnce();
		expect(server(0).sent.slice(-2)).toStrictEqual([
			{ jsonrpc: "2.0", method: "textDocument/didSave", params: {} },
			{ id: 2, jsonrpc: "2.0", method: "textDocument/definition", params: {} },
		]);

		proxy.fromServer(server(0), { id: 2, jsonrpc: "2.0", result: null });
		lastTimer().callback();

		expect(server(0).stop).toHaveBeenCalledOnce();

		proxy.fromServer(server(0), { jsonrpc: "2.0", method: "window/logMessage", params: {} });

		expect(toClient).toHaveLength(3);
	});

	it("should restart after an idle stop and answer repeat registrations itself", () => {
		expect.assertions(3);

		const { answerInitialize, client, lastTimer, proxy, server, servers, toClient } =
			startRunning();
		proxy.fromServer(server(0), {
			id: "r1",
			jsonrpc: "2.0",
			method: "client/registerCapability",
			params: {},
		});
		proxy.fromServer(server(0), { id: 1, jsonrpc: "2.0", result: null });
		lastTimer().callback();
		client({ id: 2, method: "textDocument/hover", params: {} });
		proxy.serverExited(server(0));
		answerInitialize(1, { result: RESULT });
		proxy.fromServer(server(1), {
			id: "r2",
			jsonrpc: "2.0",
			method: "client/registerCapability",
			params: {},
		});

		expect(servers).toHaveLength(2);
		expect(
			toClient.filter(({ method }) => method === "client/registerCapability"),
		).toHaveLength(1);
		expect(server(1).sent.at(-1)).toStrictEqual({ id: "r2", jsonrpc: "2.0", result: null });
	});

	it("should start the server for initialize when no result is cached", () => {
		expect.assertions(3);

		const { answerInitialize, client, ports, server, toClient } = createHarness({
			cached: false,
		});
		client({ id: "c1", result: {} });
		answerInitialize(0, { result: RESULT });
		client({ method: "initialized", params: {} });

		expect(ports.writeInitializeResult).toHaveBeenCalledWith(
			JSON.stringify(CAPABILITIES),
			RESULT,
		);
		expect(toClient).toStrictEqual([{ id: 0, jsonrpc: "2.0", result: RESULT }]);
		expect(server(0).sent.slice(1)).toStrictEqual([
			{ id: "c1", jsonrpc: "2.0", result: {} },
			{ jsonrpc: "2.0", method: "initialized", params: {} },
		]);
	});

	it("should relay but not cache an initialize result without capabilities", () => {
		expect.assertions(3);

		const { answerInitialize, ports, toClient } = createHarness({ cached: false });
		answerInitialize(0, { result: {} });

		expect(ports.writeInitializeResult).not.toHaveBeenCalled();
		expect(ports.log).toHaveBeenCalledWith(expect.stringContaining("not cached"));
		expect(toClient).toStrictEqual([{ id: 0, jsonrpc: "2.0", result: {} }]);
	});

	it("should keep the idle timer off until every request is answered", () => {
		expect.assertions(2);

		const { client, proxy, server, timers } = startRunning();
		client({ id: 2, method: "textDocument/definition", params: {} });
		proxy.fromServer(server(0), { id: 1, jsonrpc: "2.0", result: null });

		expect(timers).toHaveLength(0);

		proxy.fromServer(server(0), { id: 2, jsonrpc: "2.0", result: null });

		expect(timers).toHaveLength(1);
	});

	it("should pass a server error on initialize to the client", () => {
		expect.assertions(3);

		const { answerInitialize, ports, server, toClient } = createHarness({ cached: false });
		answerInitialize(0, { error: { code: 1, message: "no" } });

		expect(toClient).toStrictEqual([
			{ id: 0, error: { code: 1, message: "no" }, jsonrpc: "2.0" },
		]);
		expect(ports.log).toHaveBeenCalledWith(
			expect.stringContaining("the language server did not start"),
		);
		expect(server(0).stop).toHaveBeenCalledOnce();
	});

	it("should fail queued requests when the server cannot start", () => {
		expect.assertions(2);

		const { answerInitialize, client, server, toClient } = createHarness();
		client({ id: 1, method: "textDocument/hover", params: {} });
		answerInitialize(0, { error: { code: 1, message: "no" } });

		expect(toClient.at(-1)).toStrictEqual({
			id: 1,
			error: { code: -32_803, message: "the language server did not start" },
			jsonrpc: "2.0",
		});
		expect(server(0).stop).toHaveBeenCalledOnce();
	});

	it("should fail queued requests when the server exits while it starts", () => {
		expect.assertions(1);

		const { client, proxy, server, toClient } = createHarness();
		client({ id: 1, method: "textDocument/hover", params: {} });
		client({ method: "textDocument/didSave", params: {} });
		proxy.serverExited(server(0));

		expect(toClient.at(-1)).toStrictEqual({
			id: 1,
			error: { code: -32_803, message: "the language server exited before it started" },
			jsonrpc: "2.0",
		});
	});

	it("should fail initialize when the server exits before it answers", () => {
		expect.assertions(1);

		const { proxy, server, toClient } = createHarness({ cached: false });
		proxy.serverExited(server(0));

		expect(toClient).toStrictEqual([
			{
				id: 0,
				error: { code: -32_803, message: "the language server exited before it started" },
				jsonrpc: "2.0",
			},
		]);
	});

	it("should fail requests in flight when the server crashes", () => {
		expect.assertions(2);

		const { proxy, server, servers, toClient } = startRunning();
		proxy.serverExited(server(0));
		proxy.serverExited(server(0));

		expect(toClient.at(-1)).toStrictEqual({
			id: 1,
			error: { code: -32_803, message: "the language server exited before it answered" },
			jsonrpc: "2.0",
		});
		expect(servers).toHaveLength(1);
	});

	it("should cancel a queued request and forward other cancels", () => {
		expect.assertions(3);

		const { answerInitialize, client, server, toClient } = createHarness();
		client({ id: 1, method: "textDocument/hover", params: {} });
		client({ method: "$/cancelRequest", params: { id: 1 } });

		expect(toClient.at(-1)).toStrictEqual({
			id: 1,
			error: { code: -32_800, message: "the request was cancelled" },
			jsonrpc: "2.0",
		});

		answerInitialize(0, { result: RESULT });
		client({ method: "$/cancelRequest", params: { id: 7 } });
		client({ method: "$/cancelRequest" });

		expect(server(0).sent.at(-2)).toStrictEqual({
			jsonrpc: "2.0",
			method: "$/cancelRequest",
			params: { id: 7 },
		});
		expect(server(0).sent.at(-1)).toStrictEqual({
			jsonrpc: "2.0",
			method: "$/cancelRequest",
		});
	});

	it("should log bad document params and keep going", () => {
		expect.assertions(1);

		const { client, ports } = createHarness();
		client({ method: "textDocument/didOpen", params: {} });

		expect(ports.log).toHaveBeenCalledWith(expect.stringMatching(/^textDocument\/didOpen: /));
	});

	it("should reject initialize params without capabilities", () => {
		expect.assertions(1);

		const { client, toClient } = createHarness();
		client({ id: 5, method: "initialize", params: {} });

		expect(toClient.at(-1)).toMatchObject({ id: 5, error: { code: -32_602 } });
	});

	it("should answer shutdown, fail the queue and stop the server", () => {
		expect.assertions(3);

		const { client, server, toClient } = createHarness();
		client({ id: 1, method: "textDocument/hover", params: {} });
		client({ id: 2, method: "shutdown" });
		client({ id: 3, method: "shutdown" });

		expect(toClient.slice(-3)).toStrictEqual([
			{
				id: 1,
				error: { code: -32_803, message: "the client shut down the server" },
				jsonrpc: "2.0",
			},
			{ id: 2, jsonrpc: "2.0", result: null },
			{ id: 3, jsonrpc: "2.0", result: null },
		]);
		expect(server(0).stop).toHaveBeenCalledOnce();
		expect(server(0).sent).toHaveLength(1);
	});

	it("should restart for requests queued while the server stops", () => {
		expect.assertions(2);

		const { client, lastTimer, proxy, server, servers } = startRunning();
		proxy.fromServer(server(0), { id: 1, jsonrpc: "2.0", result: null });
		lastTimer().callback();
		client({ id: 2, method: "textDocument/hover", params: {} });

		expect(servers).toHaveLength(1);

		proxy.serverExited(server(0));

		expect(servers).toHaveLength(2);
	});

	it("should stop the server and exit on exit", () => {
		expect.assertions(2);

		const { client, ports, server } = startRunning();
		client({ method: "exit" });

		expect(server(0).stop).toHaveBeenCalledOnce();
		expect(ports.exit).toHaveBeenCalledOnce();
	});
});
