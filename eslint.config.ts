import isentinel from "@isentinel/eslint-config";

import { vendors } from "./meta.ts";

const vendorSkillNames = Object.values(vendors).flatMap((name) => Object.values(name.skills));

export default isentinel(
	{
		name: "project/root",
		flawless: true,
		ignores: ["**/vendor/**", "**/sources/**", `**/skills/{${vendorSkillNames.join(",")}}/**`],
		roblox: false,
		rules: {
			"pnpm/yaml-enforce-settings": "off",
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
