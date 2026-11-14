import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { createReader, encodeMessage } from "../src/framing.ts";
import { LazyLspProxy } from "../src/proxy.ts";
import { resolveServer, type ServerCommand } from "../src/resolve.ts";
import { createInitializeCache, type InitializeCache } from "./initialize-cache.ts";
import { startServer } from "./server.ts";

const IDLE_STOP = 10 * 60 * 1000;

function log(problem: string): void {
	process.stderr.write(`lazy-typescript-lsp: ${problem}\n`);
}

function findPackage(projectDirectory: string, name: string): string | undefined {
	let directory = projectDirectory;
	for (;;) {
		const root = path.join(directory, "node_modules", name);
		if (fs.existsSync(path.join(root, "package.json"))) {
			return root;
		}

		const parent = path.dirname(directory);
		if (parent === directory) {
			return undefined;
		}

		directory = parent;
	}
}

function serverEnvironment(projectDirectory: string): NodeJS.ProcessEnv {
	const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
	const bin = path.join(projectDirectory, "node_modules", ".bin");
	return {
		...process.env,
		[pathKey]: [bin, process.env[pathKey]].filter(Boolean).join(path.delimiter),
	};
}

function skipCache(): undefined {
	return undefined;
}

function createCache(server: ServerCommand): InitializeCache {
	if (server.manifest === undefined) {
		return { read: skipCache, write: skipCache };
	}

	return createInitializeCache({
		directory:
			process.env["CLAUDE_PLUGIN_DATA"] ?? path.join(os.tmpdir(), "lazy-typescript-lsp"),
		log,
		serverIdentity: JSON.stringify([
			server.command,
			server.args,
			fs.readFileSync(server.manifest, "utf8"),
		]),
	});
}

const PROJECT_DIRECTORY = process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
const server = resolveServer(process.argv[2] ?? "", {
	execPath: process.execPath,
	findPackage: (name) => findPackage(PROJECT_DIRECTORY, name),
});
if (server === undefined) {
	log(
		"no language server: install @typescript/native or @typescript/native-preview in the project, or set the plugin's server option",
	);
	process.exit(1);
}

const cache = createCache(server);
const environment = serverEnvironment(PROJECT_DIRECTORY);

const proxy: LazyLspProxy = new LazyLspProxy({
	exit: () => {
		process.stdin.destroy();
	},
	idleStop: IDLE_STOP,
	log,
	readInitializeResult: cache.read,
	schedule: (callback, delay) => {
		const timer = setTimeout(callback, delay);
		return () => {
			clearTimeout(timer);
		};
	},
	sendToClient: (message) => {
		process.stdout.write(encodeMessage(message));
	},
	startServer: () => {
		return startServer(server, {
			cwd: PROJECT_DIRECTORY,
			env: environment,
			log,
			onExit: (handle) => {
				proxy.serverExited(handle);
			},
			onMessage: (handle, message) => {
				proxy.fromServer(handle, message);
			},
		});
	},
	writeInitializeResult: cache.write,
});

process.stdin.on(
	"data",
	createReader({
		onError: log,
		onMessage: (message) => {
			proxy.fromClient(message);
		},
	}),
);
process.stdin.once("end", () => {
	proxy.close();
});
