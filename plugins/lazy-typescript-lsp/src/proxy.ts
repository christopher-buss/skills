import { isDocumentSync, type OpenDocument, trackDocument } from "./documents.ts";
import type { Message } from "./framing.ts";
import { type Fields, isFields, isRequestId } from "./guards.ts";

const INITIALIZE_ID = "lazy-lsp:initialize";
const REQUEST_CANCELLED = -32_800;
const REQUEST_FAILED = -32_803;
const INVALID_PARAMS = -32_602;
const EXITED_BEFORE_ANSWER = "the language server exited before it answered";
const EXITED_BEFORE_START = "the language server exited before it started";
const REGISTRATION_METHODS = new Set(["client/registerCapability", "client/unregisterCapability"]);

export interface InitializeResult extends Fields {
	capabilities: Fields;
}

export interface ServerHandle {
	send: (message: Message) => void;
	stop: () => void;
}

export interface ProxyPorts {
	exit: () => void;
	idleStop: number;
	log: (problem: string) => void;
	readInitializeResult: (capabilitiesKey: string) => InitializeResult | undefined;
	schedule: (callback: () => void, delay: number) => () => void;
	sendToClient: (message: Message) => void;
	startServer: () => ServerHandle;
	writeInitializeResult: (capabilitiesKey: string, result: InitializeResult) => void;
}

type RequestId = number | string;

interface QueuedRequest {
	id: RequestId;
	message: Message;
}

type Phase =
	| { kind: "running"; server: ServerHandle }
	| { kind: "starting"; server: ServerHandle }
	| { kind: "stopped" }
	| { kind: "stopping"; server: ServerHandle };

export class LazyLspProxy {
	private readonly documents = new Map<string, OpenDocument>();
	private readonly pendingRequests = new Set<RequestId>();
	private readonly ports: ProxyPorts;
	private readonly queue: Array<QueuedRequest> = [];

	private cancelIdle: (() => void) | undefined;
	private capabilitiesKey = "";
	private initializeParams: unknown;
	private pendingInitializeId: RequestId | undefined;
	private phase: Phase = { kind: "stopped" };
	private starts = 0;

	constructor(ports: ProxyPorts) {
		this.ports = ports;
	}

	public close(): void {
		this.stopServer();
		this.ports.exit();
	}

	public fromClient(message: Message): void {
		const { id, method, params } = message;
		if (method === undefined) {
			this.sendToLiveServer(message);
		} else if (method === "initialize" && isRequestId(id)) {
			this.initialize(id, params);
		} else if (method === "shutdown" && isRequestId(id)) {
			this.shutdown(id);
		} else if (method === "exit") {
			this.close();
		} else if (isDocumentSync(method)) {
			this.syncDocument(method, message);
		} else if (method === "$/cancelRequest") {
			this.cancel(message);
		} else if (isRequestId(id)) {
			this.request({ id, message });
		} else {
			this.sendWhenRunning(message);
		}
	}

	public fromServer(server: ServerHandle, message: Message): void {
		if (!this.isLive(server)) {
			return;
		}

		const { id, method } = message;
		if (method === undefined) {
			this.serverResponse(server, message);
		} else if (this.starts > 1 && REGISTRATION_METHODS.has(method) && isRequestId(id)) {
			server.send({ id, jsonrpc: "2.0", result: null });
		} else {
			this.ports.sendToClient(message);
		}
	}

	public serverExited(server: ServerHandle): void {
		if (!("server" in this.phase) || this.phase.server !== server) {
			return;
		}

		const { kind } = this.phase;
		this.phase = { kind: "stopped" };
		this.clearIdle();
		this.failInFlight();
		if (kind === "starting") {
			this.failQueue(EXITED_BEFORE_START);
		} else if (this.queue.length > 0) {
			this.start();
		}
	}

	private armIdle(): void {
		this.clearIdle();
		this.cancelIdle = this.ports.schedule(() => {
			this.cancelIdle = undefined;
			this.stopServer();
		}, this.ports.idleStop);
	}

	private cancel(message: Message): void {
		const cancelled = isFields(message.params) ? message.params["id"] : undefined;
		const index = isRequestId(cancelled)
			? this.queue.findIndex(({ id }) => id === cancelled)
			: -1;
		const queued = this.queue[index];
		if (queued === undefined) {
			this.sendWhenRunning(message);
			return;
		}

		this.queue.splice(index, 1);
		this.fail(queued.id, { code: REQUEST_CANCELLED, message: "the request was cancelled" });
	}

	private clearIdle(): void {
		this.cancelIdle?.();
		this.cancelIdle = undefined;
	}

	private fail(id: RequestId, error: { code: number; message: string }): void {
		this.ports.sendToClient({ id, error, jsonrpc: "2.0" });
	}

	private failInFlight(): void {
		for (const id of this.pendingRequests) {
			this.fail(id, { code: REQUEST_FAILED, message: EXITED_BEFORE_ANSWER });
		}

		this.pendingRequests.clear();
		if (this.pendingInitializeId !== undefined) {
			this.fail(this.pendingInitializeId, {
				code: REQUEST_FAILED,
				message: EXITED_BEFORE_START,
			});
			this.pendingInitializeId = undefined;
		}
	}

	private failQueue(text: string): void {
		for (const { id } of this.queue.splice(0)) {
			this.fail(id, { code: REQUEST_FAILED, message: text });
		}
	}

	private initialize(id: RequestId, parameters: unknown): void {
		if (!hasCapabilities(parameters)) {
			this.fail(id, {
				code: INVALID_PARAMS,
				message: "initialize: capabilities must be an object",
			});
			return;
		}

		this.initializeParams = parameters;
		this.capabilitiesKey = JSON.stringify(parameters.capabilities);
		const result = this.ports.readInitializeResult(this.capabilitiesKey);
		if (result === undefined) {
			this.pendingInitializeId = id;
			this.start();
		} else {
			this.ports.sendToClient({ id, jsonrpc: "2.0", result });
		}
	}

	private initializeFailed(error: unknown): void {
		this.ports.log(`the language server did not start: ${JSON.stringify(error)}`);
		if (this.pendingInitializeId !== undefined) {
			this.ports.sendToClient({ id: this.pendingInitializeId, error, jsonrpc: "2.0" });
			this.pendingInitializeId = undefined;
		}

		this.failQueue("the language server did not start");
		this.stopServer();
	}

	private initializeResponse(server: ServerHandle, message: Message): void {
		if (message.error !== undefined) {
			this.initializeFailed(message.error);
			return;
		}

		if (this.pendingInitializeId === undefined) {
			this.replaySession(server);
		} else {
			this.relayInitializeResult(this.pendingInitializeId, message.result);
			this.pendingInitializeId = undefined;
		}

		this.phase = { kind: "running", server };
		for (const queued of this.queue.splice(0)) {
			this.request(queued);
		}

		if (this.pendingRequests.size === 0) {
			this.armIdle();
		}
	}

	private isLive(server: ServerHandle): boolean {
		return this.liveServer() === server;
	}

	private liveServer(): ServerHandle | undefined {
		return this.phase.kind === "running" || this.phase.kind === "starting"
			? this.phase.server
			: undefined;
	}

	private relayInitializeResult(id: RequestId, result: unknown): void {
		if (hasCapabilities(result)) {
			this.ports.writeInitializeResult(this.capabilitiesKey, result);
		} else {
			this.ports.log("the initialize result is not cached: it has no capabilities object");
		}

		this.ports.sendToClient({ id, jsonrpc: "2.0", result });
	}

	private replaySession(server: ServerHandle): void {
		server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
		for (const document of this.documents.values()) {
			server.send({
				jsonrpc: "2.0",
				method: "textDocument/didOpen",
				params: { textDocument: { ...document } },
			});
		}
	}

	private request(queued: QueuedRequest): void {
		this.clearIdle();
		if (this.phase.kind !== "running") {
			this.queue.push(queued);
			if (this.phase.kind === "stopped") {
				this.start();
			}

			return;
		}

		this.pendingRequests.add(queued.id);
		this.phase.server.send(queued.message);
	}

	private sendToLiveServer(message: Message): void {
		this.liveServer()?.send(message);
	}

	private sendWhenRunning(message: Message): void {
		if (this.phase.kind === "running") {
			this.phase.server.send(message);
		}
	}

	private serverResponse(server: ServerHandle, message: Message): void {
		const { id } = message;
		if (id === INITIALIZE_ID) {
			this.initializeResponse(server, message);
			return;
		}

		if (!isRequestId(id) || !this.pendingRequests.delete(id)) {
			return;
		}

		this.ports.sendToClient(message);
		if (this.pendingRequests.size === 0) {
			this.armIdle();
		}
	}

	private shutdown(id: RequestId): void {
		this.failQueue("the client shut down the server");
		this.stopServer();
		this.ports.sendToClient({ id, jsonrpc: "2.0", result: null });
	}

	private start(): void {
		this.starts += 1;
		const server = this.ports.startServer();
		this.phase = { kind: "starting", server };
		server.send({
			id: INITIALIZE_ID,
			jsonrpc: "2.0",
			method: "initialize",
			params: this.initializeParams,
		});
	}

	private stopServer(): void {
		this.clearIdle();
		const server = this.liveServer();
		if (server !== undefined) {
			this.phase = { kind: "stopping", server };
			server.stop();
		}
	}

	private syncDocument(method: string, message: Message): void {
		const problem = trackDocument(this.documents, { method, params: message.params });
		if (problem !== undefined) {
			this.ports.log(`${method}: ${problem}`);
		}

		this.sendWhenRunning(message);
	}
}

export function hasCapabilities(value: unknown): value is InitializeResult {
	return isFields(value) && isFields(value["capabilities"]);
}
