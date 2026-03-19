import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const HOOK_NAME = process.argv[2];
const require = createRequire(`${process.cwd()}/package.json`);

function resolveHook(): string {
	try {
		return require.resolve(`@isentinel/hooks/hooks/${HOOK_NAME}`);
	} catch {
		const bar = "!".repeat(60);
		process.stderr.write(`\n${bar}\n`);
		process.stderr.write("  SENTINEL HOOKS NOT INSTALLED\n");
		process.stderr.write("  Run: pnpm add -D @isentinel/hooks\n");
		process.stderr.write(`${bar}\n\n`);
		process.exit(1);
	}
}

const RESOLVED = resolveHook();
try {
	// eslint-disable-next-line antfu/no-top-level-await -- hook entry point
	await import(pathToFileURL(RESOLVED).href);
} catch (err) {
	const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(`\n[${HOOK_NAME}] Hook failed:\n${message}\n`);
	process.exit(1);
}
