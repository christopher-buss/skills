import type { On } from "claude-code";
import { expect, test } from "claude-code/testing";

const ROOT = "/repo";
const CLI = `${ROOT}/node_modules/@commitlint/cli`;

function posix(path: string | undefined): string {
	return (path ?? "").replaceAll("\\", "/").replace(/^[A-Z]:/u, "");
}

function ran(exitCode: number, stdout: string, stderr: string) {
	return { exitCode, isStderrTruncated: false, isStdoutTruncated: false, stderr, stdout };
}

const FILES: Partial<Record<string, string>> = Object.fromEntries([
	[`${CLI}/package.json`, JSON.stringify({ bin: { commitlint: "./cli.js" } })],
	[`${ROOT}/package.json`, "{}"],
]);
const EXISTING = new Set([`${CLI}/cli.js`, `${ROOT}/.git`, `${ROOT}/commitlint.config.ts`]);

test("a command without gh pr passes untouched", async ($, on) => {
	let didSpawn = false;
	on("process.run", () => {
		didSpawn = true;
		return { value: ran(0, "", "") };
	});
	on("tool.call", () => ({ result: "ok" }));

	const result = await $.tool.call({ command: "git status", tool: "Bash" });

	expect(result.result).toBe("ok");
	expect(didSpawn).toBe(false);
});

function repo(on: On, exitCode: "reject" | number, runs: Array<unknown>): void {
	on("session.cwd", () => ({ value: `${ROOT}/sub` }));
	on("fs.exists", (_, e) => ({ value: EXISTING.has(posix(e.path)) }));
	on("fs.read", (_, e) => {
		const text = FILES[posix(e.path)];
		return text === undefined ? { deny: "ENOENT" } : { value: text };
	});
	on("process.run", (_, e) => {
		runs.push({ argv: e.argv.map(posix), cwd: posix(e.init?.cwd), stdin: e.init?.stdin });
		return exitCode === "reject"
			? { deny: "timed out" }
			: { value: ran(exitCode, "x   subject may not be empty", "") };
	});
	on("tool.call", () => ({ result: "ok" }));
}

test("a bad literal title is denied with commitlint output", async ($, on) => {
	const runs: Array<unknown> = [];
	repo(on, 1, runs);

	const result = await $.tool.call({
		command: 'gh pr create --title "bad title" --body b',
		tool: "Bash",
	});

	expect(result.deny).toMatch(/subject may not be empty/);
	expect(result.deny).toMatch(/bad title/);
	expect(runs).toEqual([{ argv: ["node", `${CLI}/cli.js`], cwd: ROOT, stdin: "bad title" }]);
});

test("a good literal title passes", async ($, on) => {
	const runs: Array<unknown> = [];
	repo(on, 0, runs);

	const result = await $.tool.call({
		command: "gh pr edit 3 -t 'feat: add x'",
		tool: "PowerShell",
	});

	expect(result.result).toBe("ok");
	expect(runs).toHaveLength(1);
});

test("a title it cannot parse is denied without running commitlint", async ($, on) => {
	const runs: Array<unknown> = [];
	repo(on, 0, runs);

	const result = await $.tool.call({
		command: 'gh pr create --title "$(cat t.txt)"',
		tool: "Bash",
	});

	expect(result.deny).toMatch(
		/Run instead:\ngh pr create --title "<type>\(<scope>\): <subject>"$/,
	);
	expect(runs).toEqual([]);
});

function uninstalled(on: On, lockfile: string): void {
	on("session.cwd", () => ({ value: ROOT }));
	on("fs.exists", (_, e) => {
		return {
			value:
				[`${ROOT}/${lockfile}`, ...EXISTING].includes(posix(e.path)) &&
				posix(e.path) !== `${CLI}/cli.js`,
		};
	});
	on("fs.read", () => ({ deny: "ENOENT" }));
	on("tool.call", () => ({ result: "ok" }));
}

for (const [lockfile, install] of [
	["pnpm-lock.yaml", "pnpm install"],
	["package-lock.json", "npm install"],
	["yarn.lock", "yarn install"],
	["bun.lock", "bun install"],
	["bun.lockb", "bun install"],
	["none", "npm install"],
] as const) {
	test(`a repo without the CLI installed is told to run ${install} (${lockfile})`, async ($, on) => {
		uninstalled(on, lockfile);

		const result = await $.tool.call({ command: "gh pr create -t 'feat: x'", tool: "Bash" });

		expect(result.deny).toMatch(
			new RegExp(`Run \`${install}\` in .*${ROOT}, then the same command\.$`),
		);
	});
}

test("an encoded PowerShell command is denied", async ($, on) => {
	on("tool.call", () => ({ result: "ok" }));

	const result = await $.tool.call({
		command: "pwsh -NoProfile -enc ZQBjAGgAbwA=",
		tool: "PowerShell",
	});

	expect(result.deny).toMatch(/`pwsh -EncodedCommand` hides its script/);
});

test("a rejected run is denied with the error", async ($, on) => {
	repo(on, "reject", []);

	const result = await $.tool.call({ command: "gh pr create -t 'feat: x'", tool: "Bash" });

	expect(result.deny).toMatch(
		/did not run on the PR title "feat: x": .*timed out\nRetry the command, or check the title by hand: printf '%s\\n' 'feat: x' \| npx commitlint$/,
	);
});

function stage(
	on: On,
	existing: ReadonlySet<string>,
	files: Partial<Record<string, string>>,
	runs: Array<string>,
): void {
	on("session.cwd", () => ({ value: ROOT }));
	on("fs.exists", (_, e) => ({ value: existing.has(posix(e.path)) }));
	on("fs.read", (_, e) => {
		const text = files[posix(e.path)];
		return text === undefined ? { deny: "ENOENT" } : { value: text };
	});
	on("process.run", (_, e) => {
		const stdin = String(e.init?.stdin);
		runs.push(stdin);
		return { value: ran(stdin.startsWith("feat") ? 0 : 1, "x   type may not be empty", "") };
	});
	on("tool.call", () => ({ result: "ok" }));
}

test("a folder outside a repository passes", async ($, on) => {
	const runs: Array<string> = [];
	stage(on, new Set(), FILES, runs);

	const result = await $.tool.call({ command: "gh pr create -t bad", tool: "Bash" });

	expect(result.result).toBe("ok");
	expect(runs).toEqual([]);
});

test("a repository without commitlint config passes", async ($, on) => {
	const runs: Array<string> = [];
	stage(on, new Set([`${CLI}/cli.js`, `${ROOT}/.git`]), FILES, runs);

	const result = await $.tool.call({ command: "gh pr create -t bad", tool: "Bash" });

	expect(result.result).toBe("ok");
	expect(runs).toEqual([]);
});

test("a commitlint key in package.json runs commitlint", async ($, on) => {
	const runs: Array<string> = [];
	stage(
		on,
		new Set([`${CLI}/cli.js`, `${ROOT}/.git`]),
		{ ...FILES, [`${ROOT}/package.json`]: '{"commitlint":{}}' },
		runs,
	);

	const result = await $.tool.call({ command: "gh pr create -t bad", tool: "Bash" });

	expect(result.deny).toMatch(/type may not be empty/);
	expect(runs).toEqual(["bad"]);
});

test("gh pr edit without a title passes", async ($, on) => {
	const runs: Array<string> = [];
	stage(on, EXISTING, FILES, runs);

	const result = await $.tool.call({ command: "gh pr edit 3 --body b", tool: "Bash" });

	expect(result.result).toBe("ok");
	expect(runs).toEqual([]);
});

test("a bad second title in one command is denied", async ($, on) => {
	const runs: Array<string> = [];
	stage(on, EXISTING, FILES, runs);

	const result = await $.tool.call({
		command: "gh pr edit 1 -t 'feat: a' && gh pr edit 2 -t bad",
		tool: "Bash",
	});

	expect(result.deny).toMatch(/"bad"/);
	expect(runs).toEqual(["feat: a", "bad"]);
});

test("a failure while checking is denied", async ($, on) => {
	on("session.cwd", () => ({ deny: "no session" }));
	on("tool.call", () => ({ result: "ok" }));

	const result = await $.tool.call({ command: "gh pr create -t 'feat: x'", tool: "Bash" });

	expect(result.deny).toMatch(/did not run on the PR title: .*\n.*'<title>' \| npx commitlint$/);
});
