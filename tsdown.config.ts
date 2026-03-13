import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	dts: true,
	entry: [
		"scripts/lint.ts",
		"scripts/type-check.ts",
		"hooks/lint.ts",
		"hooks/lint-guard.ts",
		"hooks/lint-stop.ts",
		"hooks/type-check.ts",
		"hooks/type-check-stop.ts",
		"hooks/clear-lint-state.ts",
	],
	external: ["@constellos/claude-code-kit"],
	fixedExtension: true,
	hash: false,
	inlineOnly: false,
	publint: true,
	shims: true,
	target: ["node24"],
});
