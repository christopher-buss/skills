import isentinel, { GLOB_MARKDOWN, GLOB_SRC, GLOB_TESTS, GLOB_TS } from "@isentinel/eslint-config";

import type { VendorSkillMeta } from "./meta.ts";
import { vendors } from "./meta.ts";

const vendorSkillNames = Object.values(vendors).flatMap((name: VendorSkillMeta) => {
	return Object.values(name.skills);
});

export default isentinel(
	{
		name: "project/root",
		flawless: true,
		ignores: [
			"**/vendor/**",
			"**/sources/**",
			`**/skills/{${vendorSkillNames.join(",")}}/**`,
			"skill-test",
			"plugins/*/.claude-plugin/types/**",
			"!.claude",
			".claude/**/*",
			"!.claude/**/*.json",
		],
		roblox: {
			files: [`${GLOB_MARKDOWN}/${GLOB_TS}`],
			filesTypeAware: [""],
		},
		rules: {
			"no-restricted-syntax": [
				"error",
				{
					message:
						"Don't annotate initialized object variables. Prefer inference or use 'satisfies' instead.",
					selector:
						"VariableDeclarator[init.type='ObjectExpression'] > Identifier[typeAnnotation]",
				},
			],
			"roblox/no-user-defined-lua-tuple": "off",
		},
		test: {
			vitest: true,
		},
		type: "package",
		typescript: {
			outOfProjectFiles: ["*.config.ts", "wrapper.ts"],
		},
	},
	{
		name: "project/scripts",
		files: [`**/scripts/${GLOB_SRC}`, `**/hooks/${GLOB_SRC}`],
		rules: {
			"antfu/no-top-level-await": "off",
			"max-lines": "off",
			"max-lines-per-function": "off",
			"sonar/cognitive-complexity": "off",
		},
	},
	{
		name: "project/tests",
		files: [...GLOB_TESTS],
		rules: {
			"sonar/no-duplicate-string": "off",
		},
	},
	{
		name: "project/plugin-engine",
		files: ["plugins/*/hooks/**/*.ts", "plugins/*/tests/**/*.test.ts"],
		rules: {
			// The engine names its interface `$`.
			"id-length": [
				"error",
				{
					exceptions: ["_", "$", "x", "y", "z", "a", "b", "e"],
					max: 30,
					min: 2,
					properties: "never",
				},
			],
			// Both run for minutes per file on the engine's `on` overloads.
			"ts/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }],
			"ts/strict-void-return": "off",
		},
	},
	{
		name: "project/plugin-tests",
		files: ["plugins/*/tests/**/*.test.ts"],
		rules: {
			// `claude plugin test` runs `.test.ts` and supplies `test`/`expect`.
			"vitest/consistent-test-filename": "off",
			"vitest/prefer-importing-vitest-globals": "off",
		},
	},
);
