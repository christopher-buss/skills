import { defineConfig } from "tsdown";

const bundleExternals = [
	"@cacheable/memory",
	"@cacheable/utils",
	"file-entry-cache",
	"flat-cache",
	"flatted",
	"hashery",
	"hookified",
];

export default defineConfig({
	clean: true,
	entry: [
		"scripts/lint.ts",
		"hooks/lint.ts",
		"hooks/lint-guard.ts",
		"hooks/lint-stop.ts",
		"hooks/type-check.ts",
		"hooks/type-check-stop.ts",
		"hooks/clear-lint-state.ts",
	],
	fixedExtension: true,
	hash: false,
	inlineOnly: bundleExternals,
	shims: true,
	target: ["node24"],
});
