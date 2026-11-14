import { type ChildProcessByStdio, spawn } from "node:child_process";
import process from "node:process";
import type { Readable, Writable } from "node:stream";

import { createReader, encodeMessage, type Message } from "../src/framing.ts";
import type { ServerHandle } from "../src/proxy.ts";
import type { ServerCommand } from "../src/resolve.ts";

const KILL_DELAY = 5000;

export interface ServerOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	log: (problem: string) => void;
	onExit: (server: ServerHandle) => void;
	onMessage: (server: ServerHandle, message: Message) => void;
}

interface WatchOptions {
	handle: ServerHandle;
	log: (problem: string) => void;
	onExit: (server: ServerHandle) => void;
	onMessage: (server: ServerHandle, message: Message) => void;
}

type ServerChild = ChildProcessByStdio<Writable, Readable, null>;

export function startServer(
	{ args, command, shell }: ServerCommand,
	{ cwd, env, log, onExit, onMessage }: ServerOptions,
): ServerHandle {
	const child = spawn(command, args, {
		cwd,
		env,
		shell,
		stdio: ["pipe", "pipe", "inherit"],
		windowsHide: true,
	});
	const handle = {
		send: (message) => {
			if (child.stdin.writable) {
				child.stdin.write(encodeMessage(message));
			}
		},
		stop: () => {
			stopChild(child, log);
		},
	} satisfies ServerHandle;

	watchChild(child, { handle, log, onExit, onMessage });
	return handle;
}

function watchChild(child: ServerChild, { handle, log, onExit, onMessage }: WatchOptions): void {
	child.stdin.on("error", (err) => {
		log(`server stdin: ${err.message}`);
	});
	child.stdout.on(
		"data",
		createReader({
			onError: log,
			onMessage: (message) => {
				onMessage(handle, message);
			},
		}),
	);
	child.once("error", (err) => {
		log(`the language server did not start: ${err.message}`);
		onExit(handle);
	});
	child.once("exit", () => {
		onExit(handle);
	});
}

function killTree(pid: number, log: (problem: string) => void): void {
	if (process.platform !== "win32") {
		process.kill(pid, "SIGKILL");
		return;
	}

	spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
		stdio: "ignore",
		windowsHide: true,
	}).once("error", (err) => {
		log(`cannot kill the language server: ${err.message}`);
	});
}

function stopChild(child: ServerChild, log: (problem: string) => void): void {
	child.stdin.end();
	const timer = setTimeout(() => {
		if (child.exitCode === null && child.pid !== undefined) {
			killTree(child.pid, log);
		}
	}, KILL_DELAY);
	child.once("exit", () => {
		clearTimeout(timer);
	});
}
