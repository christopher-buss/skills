import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { hasCapabilities, type InitializeResult } from "../src/proxy.ts";

export interface InitializeCache {
	read: (capabilitiesKey: string) => InitializeResult | undefined;
	write: (capabilitiesKey: string, result: InitializeResult) => void;
}

interface CacheOptions {
	directory: string;
	log: (problem: string) => void;
	serverIdentity: string;
}

export function createInitializeCache(options: CacheOptions): InitializeCache {
	return {
		read: (capabilitiesKey) => readResult(cacheFile(options, capabilitiesKey)),
		write: (capabilitiesKey, result) => {
			writeResult(options, { file: cacheFile(options, capabilitiesKey), result });
		},
	};
}

function cacheFile({ directory, serverIdentity }: CacheOptions, capabilitiesKey: string): string {
	const key = createHash("sha256")
		.update(serverIdentity)
		.update(capabilitiesKey)
		.digest("hex")
		.slice(0, 16);
	return path.join(directory, `${key}.json`);
}

function readResult(file: string): InitializeResult | undefined {
	try {
		const cached: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		return hasCapabilities(cached) ? cached : undefined;
	} catch {
		return undefined;
	}
}

function writeResult(
	{ directory, log }: CacheOptions,
	{ file, result }: { file: string; result: InitializeResult },
): void {
	try {
		fs.mkdirSync(directory, { recursive: true });
		fs.writeFileSync(file, JSON.stringify(result));
	} catch (err) {
		log(`cannot cache the initialize result: ${String(err)}`);
	}
}
