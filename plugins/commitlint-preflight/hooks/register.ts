import type { EngineInterface, Register } from "claude-code";

import { errorReason, failedReason, missingCliReason } from "../src/messages.ts";
import {
	ancestors,
	binEntry,
	CLI_PACKAGE,
	COMMITLINT_CONFIG_FILES,
	hasCommitlintKey,
	join,
	LOCK_FILES,
} from "../src/repo.ts";
import type { Dialect } from "../src/shell.ts";
import { findTitleChecks, mayHoldTitle } from "../src/titles.ts";

const TIMEOUT_MS = 30_000;

async function findRoot($: EngineInterface): Promise<string | undefined> {
	for (const directory of ancestors(await $.session.cwd())) {
		if (await $.fs.exists(join(directory, ".git"))) {
			return directory;
		}
	}

	return undefined;
}

async function readText($: EngineInterface, path: string): Promise<string | undefined> {
	try {
		return await $.fs.read(path);
	} catch {
		return undefined;
	}
}

async function usesCommitlint($: EngineInterface, root: string): Promise<boolean> {
	for (const name of COMMITLINT_CONFIG_FILES) {
		if (await $.fs.exists(join(root, name))) {
			return true;
		}
	}

	return hasCommitlintKey((await readText($, join(root, "package.json"))) ?? "");
}

async function cliEntry($: EngineInterface, root: string): Promise<string | undefined> {
	const packageDirectory = join(root, CLI_PACKAGE);
	const entry = binEntry((await readText($, join(packageDirectory, "package.json"))) ?? "");
	return entry !== undefined && (await $.fs.exists(join(packageDirectory, entry)))
		? join(packageDirectory, entry)
		: undefined;
}

async function installCommand($: EngineInterface, root: string): Promise<string> {
	for (const [lockfile, install] of LOCK_FILES) {
		if (await $.fs.exists(join(root, lockfile))) {
			return install;
		}
	}

	return "npm install";
}

async function lint(
	$: EngineInterface,
	root: string,
	cli: string,
	title: string,
): Promise<string | undefined> {
	try {
		const { exitCode, stderr, stdout } = await $.process.run(["node", cli], {
			cwd: root,
			stdin: title,
			timeoutMs: TIMEOUT_MS,
		});
		return exitCode === 0 ? undefined : failedReason(title, `${stdout}\n${stderr}`.trim());
	} catch (err) {
		return errorReason(title, err);
	}
}

async function evaluate(
	$: EngineInterface,
	command: string,
	dialect: Dialect,
): Promise<string | undefined> {
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
		return missingCliReason(root, await installCommand($, root));
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
		if (!mayHoldTitle(e.command)) {
			return next(e);
		}

		const reason = await evaluate(
			$,
			e.command,
			e.tool === "Bash" ? "bash" : "powershell",
		).catch((err: unknown) => errorReason(undefined, err));
		return reason === undefined ? next(e) : { deny: reason };
	});
};
