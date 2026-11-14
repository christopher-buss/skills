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

Its `.claude-plugin/types/` holds the mods API types that Claude Code writes, so
lint and typecheck work from a clone. After a Claude Code upgrade, refresh them
and commit the diff:

```bash
claude -p --plugin-dir plugins/commitlint-preflight "reply ok"
git add -f plugins/commitlint-preflight/.claude-plugin/types/claude-code{,-tools}/index.d.ts
```

### lazy-typescript-lsp

A TypeScript language server for Claude Code's LSP tool that starts only when
the tool sends a request. Claude Code starts `lsp/main.ts`, a stdio proxy. It
answers `initialize` from a cache keyed by the server's version and the client
capabilities, and starts the real server on the first LSP request. File opens
and edits only update the proxy's copy of each document; a new server gets them
replayed. After 10 minutes with no request in flight, the proxy stops the server.
The first request after a stop waits for the server to load the project.
Diagnostics are off: run the project's type check for errors.

The server sees Edit and Write changes, but not files that another process
creates or changes, such as a shell edit or a `git checkout`; start a new
session after one.

By default it runs TypeScript 7 from the project: `@typescript/native`, then
`@typescript/native-preview`, with `--lsp --stdio`. To run a different server,
set the plugin's `server` option to a command line, such as
`tsrs --lsp --stdio`. The command runs through the shell in the project
directory, with `node_modules/.bin` on `PATH`. When the command's first word is
not a package in `node_modules`, the proxy cannot tell the server's version, so
it does not cache `initialize` and starts the server at session start.

```json
{
	"enabledPlugins": {
		"lazy-typescript-lsp@isentinel": true
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
