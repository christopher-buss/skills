import { Buffer } from "node:buffer";
import process from "node:process";

export async function readStdinJson<T = unknown>(): Promise<T> {
	return new Promise((resolve, reject) => {
		const chunks: Array<Buffer> = [];
		process.stdin.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		process.stdin.on("end", () => {
			try {
				const data = Buffer.concat(chunks).toString("utf8");
				resolve(JSON.parse(data) as T);
			} catch (err) {
				reject(new Error(`Failed to parse JSON input: ${err}`));
			}
		});
		process.stdin.on("error", (error: Error) => {
			reject(new Error(`Failed to read stdin: ${error}`));
		});
	});
}

export function writeStdoutJson(output: unknown): void {
	process.stdout.write(`${JSON.stringify(output)}\n`);
}
