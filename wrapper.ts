import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const HOOK_NAME = process.argv[2];
const require = createRequire(`${process.cwd()}/package.json`);

try {
	const resolved = require.resolve(`@isentinel/hooks/hooks/${HOOK_NAME}`);
	// eslint-disable-next-line antfu/no-top-level-await -- hook entry point
	await import(pathToFileURL(resolved).href);
} catch {
	const bar = "!".repeat(60);
	process.stderr.write(`\n${bar}\n`);
	process.stderr.write("  SENTINEL HOOKS NOT INSTALLED\n");
	process.stderr.write("  Run: pnpm add -D @isentinel/hooks\n");
	process.stderr.write(`${bar}\n\n`);
	process.exit(1);
}
