export interface VendorSkillMeta {
	official?: boolean;
	/** Skills to sync verbatim: SourceSkillName -> outputSkillName. */
	skills: Record<string, string>;
	source: string;
}

/** Repositories to clone as submodules and generate skills from source. */
export const submodules = {
	"ecs-faq": "https://github.com/SanderMertens/ecs-faq",
	"flecs": "https://github.com/SanderMertens/flecs",
	"jecs": "https://github.com/Ukendio/jecs",
	"jest": "https://github.com/Roblox/jest-roblox",
	"pnpm": "https://github.com/pnpm/pnpm.io",
	"roblox-ts": "https://github.com/roblox-ts/roblox-ts.com",
	"superpowers": "https://github.com/obra/superpowers",
};

/** Already generated skills, sync with their `skills/` directory. */
export const vendors = {
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
} satisfies Record<string, VendorSkillMeta>;

/** Hand-written skills. */
export const manual = ["isentinel", "ecs-design"];
