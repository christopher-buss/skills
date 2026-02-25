import isentinel, { GLOB_MARKDOWN, GLOB_TESTS, GLOB_TS } from "@isentinel/eslint-config";

import type { VendorSkillMeta } from "./meta.ts";
import { vendors } from "./meta.ts";

const vendorSkillNames = Object.values(vendors).flatMap((name: VendorSkillMeta) => {
	return Object.values(name.skills);
});

export default isentinel(
	{
		name: "project/root",
		flawless: true,
		formatters: {
			markdown: false,
		},
		ignores: [
			"**/vendor/**",
			"**/sources/**",
			`**/skills/{${vendorSkillNames.join(",")}}/**`,
			"skill-test",
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
			outOfProjectFiles: ["eslint.config.ts", "vitest.config.ts"],
		},
	},
	{
		name: "project/scripts",
		files: ["scripts/*"],
		rules: {
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
);
