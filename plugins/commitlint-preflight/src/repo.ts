export const NAME = "commitlint-preflight";

/** The config file names commitlint reads at a repository root. */
export const COMMITLINT_CONFIG_FILES: ReadonlyArray<string> = [
	".commitlintrc",
	...["json", "yaml", "yml", "js", "cjs", "mjs", "ts", "cts", "mts"].map(
		(extension) => `.commitlintrc.${extension}`,
	),
	...["js", "cjs", "mjs", "ts", "cts", "mts"].map(
		(extension) => `commitlint.config.${extension}`,
	),
];

export const CLI_PACKAGE = "node_modules/@commitlint/cli";

/**
 * The directory and each of its parents, nearest first, with `/` separators.
 *
 * @param directory - An absolute directory, either separator.
 * @returns The directory, then each parent up to the root.
 */
export function ancestors(directory: string): Array<string> {
	const parts = directory.replaceAll("\\", "/").replace(/\/+$/u, "").split("/");
	const result: Array<string> = [];
	for (let { length } = parts; length > 0; length--) {
		const path = parts.slice(0, length).join("/");
		result.push(path === "" || path.endsWith(":") ? `${path}/` : path);
	}

	return result;
}

export function join(directory: string, path: string): string {
	return `${directory.replace(/\/$/u, "")}/${path.replace(/^\.\//u, "")}`;
}

/**
 * Whether a `package.json` text configures commitlint under a `commitlint` key.
 *
 * @param packageJson - The text of a `package.json`.
 * @returns True when the key is there.
 */
export function hasCommitlintKey(packageJson: string): boolean {
	const manifest = parseObject(packageJson);
	return manifest !== undefined && Object.hasOwn(manifest, "commitlint");
}

/**
 * The CLI entry a package's `package.json` names in `bin`.
 *
 * @param packageJson - The text of the package's `package.json`.
 * @returns The entry, relative to the package, if `bin` names one.
 */
export function binEntry(packageJson: string): string | undefined {
	const bin = parseObject(packageJson)?.["bin"];
	if (typeof bin === "string") {
		return bin;
	}

	const named =
		typeof bin === "object" && bin !== null
			? (bin as Record<string, unknown>)["commitlint"]
			: undefined;
	return typeof named === "string" ? named : undefined;
}

export function missingCliReason(root: string): string {
	return `${NAME}: ${root} configures commitlint but @commitlint/cli is not installed. Install dependencies, then run the command again.`;
}

export function failedReason(title: string, output: string): string {
	return `${NAME}: commitlint rejects the PR title "${title}". A squash merge makes it the commit message.\n${output}`;
}

export function errorReason(title: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `${NAME}: commitlint did not run on the PR title "${title}": ${message}`;
}

function parseObject(text: string): Record<string, unknown> | undefined {
	try {
		const value: unknown = JSON.parse(text);
		return typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}
