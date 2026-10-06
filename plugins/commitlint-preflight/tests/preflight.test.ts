import { expect, test } from "claude-code/testing";

const ROOT = "/repo";
const CLI = `${ROOT}/node_modules/@commitlint/cli`;

function posix(path: string | undefined): string {
	return (path ?? "").replaceAll("\\", "/").replace(/^[A-Z]:/u, "");
}

function ran(exitCode: number, stdout: string, stderr: string) {
	return { exitCode, isStderrTruncated: false, isStdoutTruncated: false, stderr, stdout };
}

const FILES: Record<string, string> = {
	[`${CLI}/package.json`]: JSON.stringify({ bin: { commitlint: "./cli.js" } }),
	[`${ROOT}/package.json`]: "{}",
};
const EXISTING = new Set([`${CLI}/cli.js`, `${ROOT}/.git`, `${ROOT}/commitlint.config.ts`]);

test("a command without gh pr passes untouched", async ($, on) => {
	let spawned = false;
	on("process.run", () => {
		spawned = true;
		return { value: ran(0, "", "") };
	});
	on("tool.call", () => ({ result: "ok" }));

	const result = await $.tool.call({ command: "git status", tool: "Bash" });

	expect(result.result).toBe("ok");
	expect(spawned).toBe(false);
});

function repo(on: Parameters<Parameters<typeof test>[1]>[1], exitCode: "reject" | number, runs: Array<unknown>): void {
	on("session.cwd", () => ({ value: `${ROOT}/sub` }));
	on("fs.exists", ($, e) => ({ value: EXISTING.has(posix(e.path)) }));
	on("fs.read", ($, e) => (posix(e.path) in FILES ? { value: FILES[posix(e.path)] } : { deny: "ENOENT" }));
	on("process.run", ($, e) => {
		runs.push({ argv: e.argv.map(posix), cwd: posix(e.init?.cwd), stdin: e.init?.stdin });
		return exitCode === "reject" ? { deny: "timed out" } : { value: ran(exitCode, "x   subject may not be empty", "") };
	});
	on("tool.call", () => ({ result: "ok" }));
}

test("a bad literal title is denied with commitlint output", async ($, on) => {
	const runs: Array<unknown> = [];
	repo(on, 1, runs);

	const result = await $.tool.call({ command: 'gh pr create --title "bad title" --body b', tool: "Bash" });

	expect(result.deny).toMatch(/subject may not be empty/);
	expect(result.deny).toMatch(/bad title/);
	expect(runs).toEqual([{ argv: ["node", `${CLI}/cli.js`], cwd: ROOT, stdin: "bad title" }]);
});

test("a good literal title passes", async ($, on) => {
	const runs: Array<unknown> = [];
	repo(on, 0, runs);

	const result = await $.tool.call({ command: "gh pr edit 3 -t 'feat: add x'", tool: "PowerShell" });

	expect(result.result).toBe("ok");
	expect(runs).toHaveLength(1);
});

test("an unparseable title is denied without running commitlint", async ($, on) => {
	const runs: Array<unknown> = [];
	repo(on, 0, runs);

	const result = await $.tool.call({ command: 'gh pr create --title "$(cat t.txt)"', tool: "Bash" });

	expect(result.deny).toMatch(/literal --title/);
	expect(runs).toEqual([]);
});

test("a repo without the CLI installed is denied", async ($, on) => {
	on("session.cwd", () => ({ value: ROOT }));
	on("fs.exists", ($, e) => ({ value: posix(e.path) !== `${CLI}/cli.js` && EXISTING.has(posix(e.path)) }));
	on("fs.read", () => ({ deny: "ENOENT" }));
	on("tool.call", () => ({ result: "ok" }));

	const result = await $.tool.call({ command: "gh pr create -t 'feat: x'", tool: "Bash" });

	expect(result.deny).toMatch(/Install dependencies/);
});

test("a rejected run is denied with the error", async ($, on) => {
	repo(on, "reject", []);

	const result = await $.tool.call({ command: "gh pr create -t 'feat: x'", tool: "Bash" });

	expect(result.deny).toMatch(/did not run/);
});
