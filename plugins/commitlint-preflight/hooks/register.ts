import type { Hook, Register } from "claude-code";

import { ancestors, binEntry, CLI_PACKAGE, COMMITLINT_CONFIG_FILES, errorReason, failedReason, hasCommitlintKey, join, missingCliReason } from "../src/repo.ts";
import type { Dialect } from "../src/shell.ts";
import { findTitleChecks, mentionsGhPr } from "../src/titles.ts";

type Api = Parameters<Hook<"tool.call">>[0];

const TIMEOUT_MS = 30_000;

async function findRoot($: Api): Promise<string | undefined> {
	for (const directory of ancestors(await $.session.cwd())) {
		if (await $.fs.exists(join(directory, ".git"))) {
			return directory;
		}
	}

	return undefined;
}

async function readText($: Api, path: string): Promise<string | undefined> {
	try {
		return await $.fs.read(path);
	} catch {
		return undefined;
	}
}

async function usesCommitlint($: Api, root: string): Promise<boolean> {
	for (const name of COMMITLINT_CONFIG_FILES) {
		if (await $.fs.exists(join(root, name))) {
			return true;
		}
	}

	return hasCommitlintKey((await readText($, join(root, "package.json"))) ?? "");
}

async function cliEntry($: Api, root: string): Promise<string | undefined> {
	const packageDirectory = join(root, CLI_PACKAGE);
	const entry = binEntry((await readText($, join(packageDirectory, "package.json"))) ?? "");
	return entry !== undefined && (await $.fs.exists(join(packageDirectory, entry))) ? join(packageDirectory, entry) : undefined;
}

async function lint($: Api, root: string, cli: string, title: string): Promise<string | undefined> {
	try {
		const { exitCode, stderr, stdout } = await $.process.run(["node", cli], { cwd: root, stdin: title, timeoutMs: TIMEOUT_MS });
		return exitCode === 0 ? undefined : failedReason(title, `${stdout}\n${stderr}`.trim());
	} catch (err) {
		return errorReason(title, err);
	}
}

async function evaluate($: Api, command: string, dialect: Dialect): Promise<string | undefined> {
	const checks = findTitleChecks(command, dialect);
	const titles: Array<string> = [];
	for (const check of checks) {
		if ("reason" in check) {
			return check.reason;
		}

		titles.push(check.title);
	}

	if (titles.length === 0) {
		return undefined;
	}

	const root = await findRoot($);
	if (root === undefined || !(await usesCommitlint($, root))) {
		return undefined;
	}

	const cli = await cliEntry($, root);
	if (cli === undefined) {
		return missingCliReason(root);
	}

	for (const title of titles) {
		const reason = await lint($, root, cli, title);
		if (reason !== undefined) {
			return reason;
		}
	}

	return undefined;
}

export const register: Register = (on) => {
	on("tool.call", { tool: ["Bash", "PowerShell"] }, async ($, e, next) => {
		if ((e.tool !== "Bash" && e.tool !== "PowerShell") || !mentionsGhPr(e.command)) {
			return next(e);
		}

		const reason = await evaluate($, e.command, e.tool === "Bash" ? "bash" : "powershell").catch((err: unknown) => errorReason("(unknown)", err));
		return reason === undefined ? next(e) : { deny: reason };
	});
};
