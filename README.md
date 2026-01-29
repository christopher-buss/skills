# Roblox Skills & Claude Code Extensions

Personal collection of [Agent Skills](https://agentskills.io/home), hooks, and
plugins for Claude Code, focused on Roblox development.

This started as a fork of [antfu/skills](https://github.com/antfu/skills). I'm
repurposing it for my own workflow but keeping it open source in case others
find it useful.

## What's here

- **Skills** - Agent skills for Roblox tooling, Luau, and related ecosystems
- **Hooks** - Custom Claude Code hooks for my workflow
- **Plugins** - Any other extensions I end up building

## Installation

```bash
pnpx skills add christopher-buss/skills
```

Or install everything globally:

```bash
pnpx skills add christopher-buss/skills --all -g
```

More on the CLI at [skills](https://github.com/vercel-labs/skills).

## Skills

### Hand-maintained

Manually written with personal preferences and best practices.

| Skill | Description |
| ----- | ----------- |
| TBD   | Coming soon |

### Generated from documentation

Generated from official docs.

| Skill                         | Description                            | Source                                                        |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| [jecs](skills/jecs)           | Entity Component System for Roblox     | [Ukendio/jecs](https://github.com/Ukendio/jecs)               |
| [pnpm](skills/pnpm)           | Fast, disk-efficient package manager   | [pnpm/pnpm.io](https://github.com/pnpm/pnpm.io)               |
| [roblox-ts](skills/robloxTs)  | TypeScript to Roblox Lua transpiler    | [roblox-ts/roblox-ts](https://github.com/roblox-ts/roblox-ts) |
| [tsdown](skills/tsdown)       | TypeScript bundler powered by Rolldown | [rolldown/tsdown](https://github.com/rolldown/tsdown)         |
| [vitepress](skills/vitepress) | Static site generator powered by Vite  | [vuejs/vitepress](https://github.com/vuejs/vitepress)         |
| [vitest](skills/vitest)       | Unit testing framework powered by Vite | [vitest-dev/vitest](https://github.com/vitest-dev/vitest)     |

### Vendored

Synced from external repos that maintain their own skills.

| Skill                         | Description                          | Source                                                  |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------- |
| [humanizer](skills/humanizer) | Remove AI writing patterns from text | [blader/humanizer](https://github.com/blader/humanizer) |
| [turborepo](skills/turborepo) | High-performance build system        | [vercel/turborepo](https://github.com/vercel/turborepo) |

## Usage

See [AGENTS.md](AGENTS.md) for how skills are generated and maintained.

## Adding your own

1. Fork this repo
2. `pnpm install`
3. Update `meta.ts` with your projects
4. `nr start cleanup` to clear existing submodules
5. `nr start init` to clone fresh
6. `nr start sync` for vendored skills
7. Have your agent generate skills one project at a time

## Attribution

Forked from [Anthony Fu's skills](https://github.com/antfu/skills). The original
project's approach of using git submodules to reference source documentation is
clever - skills stay current with upstream changes without manual updates.

## License

[MIT](LICENSE.md). Vendored skills keep their original licenses.
