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
	"jest-extended": "https://github.com/christopher-buss/rbxts-jest-extended",
	"pnpm": "https://github.com/pnpm/pnpm.io",
	"roblox-ts": "https://github.com/roblox-ts/roblox-ts.com",
};

/** Already generated skills, sync with their `skills/` directory. */
export const vendors = {} satisfies Record<string, VendorSkillMeta>;

/** Hand-written skills. */
export const manual = ["ecs-design", "roblox-ts"];
