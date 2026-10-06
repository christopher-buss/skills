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
pnpx skills add christopher-buss/skills -skill='*'
```

Or install everything globally:

```bash
pnpx skills add christopher-buss/skills -skill='*' -g
```

More on the CLI at [skills](https://github.com/vercel-labs/skills).

## Skills

### Hand-maintained

Manually written with personal preferences and best practices.

| Skill                         | Description                                                   |
| ----------------------------- | ------------------------------------------------------------- |
| [roblox-ts](skills/roblox-ts) | TypeScript to Roblox Lua transpiler                           |
| [ecs-design](skills/ecs-design) | Best practices for designing Entity Component Systems in Roblox    |

### Generated from documentation

Generated from official docs.

| Skill                             | Description                                   | Source                                                        |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| [jecs](skills/jecs)               | Entity Component System for Roblox            | [Ukendio/jecs](https://github.com/Ukendio/jecs)               |
| [pnpm](skills/pnpm)               | Fast, disk-efficient package manager          | [pnpm/pnpm.io](https://github.com/pnpm/pnpm.io)               |
| [roblox-ts](skills/robloxTs)      | TypeScript to Roblox Lua transpiler           | [roblox-ts/roblox-ts](https://github.com/roblox-ts/roblox-ts) |

## Plugins

### commitlint-preflight

A Claude Code mod that checks a PR title before `gh pr create` or `gh pr edit`
runs. A squash merge makes the PR title the commit message, so the title must
pass the repository's commitlint config.

For each `gh pr create` or `gh pr edit` in a Bash or PowerShell command, it
reads the `--title`, `--title=`, or `-t` value and runs the repository's own
`@commitlint/cli` on it. It denies the call when:

- commitlint rejects the title (the denial holds commitlint's output);
- the title is not a literal string: it holds a variable, a command
  substitution, a glob, or a here-document, or its quote does not close;
- `gh pr create` has no title flag (`--fill`, `--web`, the editor, or the
  prompt);
- a flag, wrapper, or `bash -c` / `pwsh -Command` script around `gh pr` cannot
  be parsed;
- `pwsh` or `powershell` runs an encoded command (`-EncodedCommand`, `-enc`,
  `-e`, `-ec`, and the other spellings PowerShell takes), which hides its
  script;
- the repository configures commitlint but `@commitlint/cli` is not installed.

Each denial says what it could not check and the command to run instead: the
same `gh pr` command with a literal `--title`, the install command for the
repository's package manager, or a manual commitlint check.

A repository without a commitlint config is not checked. Enable it in
`settings.json`:

```json
{
	"extraKnownMarketplaces": {
		"isentinel": {
			"source": { "source": "github", "repo": "christopher-buss/skills" }
		}
	},
	"enabledPlugins": {
		"commitlint-preflight@isentinel": true
	}
}
```

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
