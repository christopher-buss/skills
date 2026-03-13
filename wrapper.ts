const HOOK_NAME = process.argv[2];

try {
	const resolved = import.meta.resolve(`@isentinel/hooks/hooks/${HOOK_NAME}`);
	// eslint-disable-next-line antfu/no-top-level-await -- hook entry point
	await import(resolved);
} catch {
	const bar = "!".repeat(60);
	process.stderr.write(`\n${bar}\n`);
	process.stderr.write("  SENTINEL HOOKS NOT INSTALLED\n");
	process.stderr.write("  Run: pnpm add -D @isentinel/hooks\n");
	process.stderr.write(`${bar}\n\n`);
	process.exit(1);
}
