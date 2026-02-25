import process from "node:process";
import { Buffer } from "node:buffer";

//#region hooks/io.ts
async function readStdinJson() {
	return new Promise((resolve, reject) => {
		const chunks = [];
		process.stdin.on("data", (chunk) => {
			chunks.push(chunk);
		});
		process.stdin.on("end", () => {
			try {
				const data = Buffer.concat(chunks).toString("utf8");
				resolve(JSON.parse(data));
			} catch (err) {
				reject(/* @__PURE__ */ new Error(`Failed to parse JSON input: ${err}`));
			}
		});
		process.stdin.on("error", (error) => {
			reject(/* @__PURE__ */ new Error(`Failed to read stdin: ${error}`));
		});
	});
}
function writeStdoutJson(output) {
	process.stdout.write(`${JSON.stringify(output)}\n`);
}

//#endregion
export { writeStdoutJson as n, readStdinJson as t };