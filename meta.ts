export interface VendorSkillMeta {
	official?: boolean;
	/** Skills to sync verbatim: SourceSkillName -> outputSkillName. */
	skills: Record<string, string>;
	source: string;
}

/** Repositories to clone as submodules and generate skills from source. */
export const submodules = {
	jecs: "https://github.com/Ukendio/jecs",
	jest: "https://github.com/Roblox/jest-roblox",
	pnpm: "https://github.com/pnpm/pnpm.io",
	robloxTs: "https://github.com/roblox-ts/roblox-ts",
	superpowers: "https://github.com/obra/superpowers",
};

/** Already generated skills, sync with their `skills/` directory. */
export const vendors: Record<string, VendorSkillMeta> = {
	humanizer: {
		skills: {
			".": "humanizer",
		},
		source: "https://github.com/blader/humanizer",
	},
	superpowers: {
		skills: {
			"writing-plans": "writing-plans",
			"writing-skills": "writing-skills",
		},
		source: "https://github.com/obra/superpowers",
	},
};

/** Hand-written skills. */
export const manual = ["isentinel"];
