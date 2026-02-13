import isentinel, { GLOB_MARKDOWN, GLOB_TS } from "@isentinel/eslint-config";

import { vendors } from "./meta.ts";

const vendorSkillNames = Object.values(vendors).flatMap((name) => Object.values(name.skills));

export default isentinel(
	{
		name: "project/root",
		flawless: true,
		ignores: [
			"**/vendor/**",
			"**/sources/**",
			`**/skills/{${vendorSkillNames.join(",")}}/**`,
			"skill-test",
		],
		roblox: {
			files: [`${GLOB_MARKDOWN}/${GLOB_TS}`],
			filesTypeAware: [""],
		},
		rules: {
			"roblox/no-user-defined-lua-tuple": "off",
		},
		test: {
			jest: true,
		},
		type: "package",
		typescript: {
			outOfProjectFiles: ["eslint.config.ts"],
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
);
