import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveServer } from "../src/resolve.ts";

const NODE = "/bin/node";

function lookup(...installed: Array<string>) {
	return (name: string): string | undefined => {
		return installed.includes(name) ? path.join("/project/node_modules", name) : undefined;
	};
}

describe(resolveServer, () => {
	it("should start @typescript/native through node by default", () => {
		expect.assertions(1);

		expect(
			resolveServer("", {
				execPath: NODE,
				findPackage: lookup("@typescript/native", "@typescript/native-preview"),
			}),
		).toStrictEqual({
			args: [
				path.join("/project/node_modules/@typescript/native/bin/tsc"),
				"--lsp",
				"--stdio",
			],
			command: NODE,
			manifest: path.join("/project/node_modules/@typescript/native/package.json"),
			shell: false,
		});
	});

	it("should fall back to @typescript/native-preview", () => {
		expect.assertions(1);

		expect(
			resolveServer(" ", {
				execPath: NODE,
				findPackage: lookup("@typescript/native-preview"),
			}),
		).toMatchObject({
			args: [
				path.join("/project/node_modules/@typescript/native-preview/bin/tsgo.js"),
				"--lsp",
				"--stdio",
			],
		});
	});

	it("should find no server when TypeScript 7 is not installed", () => {
		expect.assertions(1);

		expect(resolveServer("", { execPath: NODE, findPackage: lookup() })).toBeUndefined();
	});

	it("should run a configured command through the shell", () => {
		expect.assertions(1);

		expect(
			resolveServer("  tsrs --lsp --stdio ", { execPath: NODE, findPackage: lookup("tsrs") }),
		).toStrictEqual({
			args: [],
			command: "tsrs --lsp --stdio",
			manifest: path.join("/project/node_modules/tsrs/package.json"),
			shell: true,
		});
	});

	it("should run a configured command that is not a package", () => {
		expect.assertions(1);

		expect(
			resolveServer("my-lsp --stdio", { execPath: NODE, findPackage: lookup() }),
		).toMatchObject({ command: "my-lsp --stdio", manifest: undefined });
	});
});
