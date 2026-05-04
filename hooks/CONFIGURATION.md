# `@isentinel/hooks` configuration

The lint and typecheck hooks read project-local settings from
`.claude/sentinel.local.md`. Settings live in the file's YAML frontmatter; any
markdown body is ignored.

```yaml
---
lint: true
lint-cadence: tiered
max-lint-errors: 10
---
```

If the file is absent, every setting falls back to its default. Unknown keys are
ignored.

## Settings

| Setting              | Frontmatter key          | Type                                  | Default       | Description                                                                                                              |
| -------------------- | ------------------------ | ------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `lint`               | `lint`                   | `boolean`                             | `true`        | Master switch for the lint hooks. When `false`, every lint hook (`PostToolUse`, `PostToolBatch`, `Stop`, `SubagentStop`, `TaskCompleted`) exits immediately. |
| `typecheck`          | `typecheck`              | `boolean`                             | `true`        | Master switch for the typecheck hooks. When `false`, the `PostToolUse` typecheck hook and the `Stop` typecheck hook exit immediately. |
| `eslint`             | `eslint`                 | `boolean`                             | `true`        | Run ESLint (`eslint_d`) as part of the lint pass. Disable to skip ESLint while keeping other lint plumbing active. |
| `oxlint`             | `oxlint`                 | `boolean`                             | `false`       | Run Oxlint as part of the lint pass. Combine with `eslint: false` for an Oxlint-only setup. |
| `runner`             | `runner`                 | `string`                              | `"pnpm exec"` | Command prefix used to invoke `eslint_d`, `oxlint`, `tsgo`, and `madge`. Set to `"npx"`, `"yarn"`, `"bun x"`, etc. to match your package manager. |
| `debug`              | `debug`                  | `boolean`                             | `false`       | When `true`, the `Stop` lint hook and `Stop` typecheck hook attach internal trace logs to their reasoning output. Useful for diagnosing why a hook surfaced (or did not surface) errors. |
| `maxLintAttempts`    | `max-lint-attempts`      | `number`                              | `1`           | Per-file ceiling on consecutive lint surfaces before the `PostToolUse` hook injects a "fix loop appears stuck" notice and the typecheck hook injects a CRITICAL "stop editing this file" notice. Counter resets when the file lints clean. |
| `maxLintErrors`      | `max-lint-errors`        | `number`                              | `10`          | Maximum number of error lines included in a surface. Any overflow is summarized as `+ N more issues — run pnpm lint to see all`. |
| `lintCadence`        | `lint-cadence`           | `"strict" \| "tiered" \| "stop-only"` | `"strict"`    | Controls when the lint hook surfaces errors. See [Cadence modes](#cadence-modes). |
| `lintAutoFixOnBatch` | `lint-auto-fix-on-batch` | `boolean`                             | `true`        | Only used when `lintCadence` is `tiered` or `stop-only`. When `true`, the `PostToolBatch` hook runs `eslint --fix` on every file edited in the batch but does not surface results. Disable to skip the silent batch-fix pass. |
| `cacheBust`          | `cache-bust`             | comma-separated globs                 | `*.config.*, **/tsconfig*.json` | Globs that force a full ESLint cache wipe when their mtime is newer than the cache. User patterns are appended to the defaults; prefix with `!` to exclude. |
| `typecheckArgs`      | `typecheck-args`         | comma-separated strings               | `[]`          | Extra arguments passed to `tsgo`. When set, replaces the default `-p <tsconfig> --noEmit --pretty false` invocation with `tsgo <args> <tsconfig>`. |

### Notes on parsing

- All values are read from YAML frontmatter as strings. Booleans use the literal
  text `true` / `false`. Quotes around values are stripped.
- `lint`, `eslint`, `typecheck` default to enabled — only the literal string
  `false` disables them.
- `oxlint` and `debug` default to disabled — only the literal string `true`
  enables them.
- `cache-bust` and `typecheck-args` are comma-separated; whitespace around each
  entry is trimmed and empty entries are dropped.
- `lint-cadence` falls back to `strict` if the value is not one of the three
  recognized strings.
- `max-lint-attempts` and `max-lint-errors` accept any number; non-numeric
  values fall back to the default (only `max-lint-errors` is guarded against
  `NaN` — invalid `max-lint-attempts` values resolve to `NaN`, which makes the
  per-file loop guard never trip).

## Cadence modes

`lintCadence` controls when lint diagnostics are surfaced to the agent. Pick
based on how chatty you want the lint feedback to be.

### `strict` (default)

- `PostToolUse` runs `eslint --fix` after every `Edit`/`Write` and surfaces any
  remaining errors immediately.
- `PostToolBatch`, `SubagentStop`, and `TaskCompleted` are no-ops.
- `Stop` re-lints all edited files plus their transitive dependents (resolved
  via `madge`) and surfaces remaining errors.

Best for short tasks where per-edit feedback is desirable.

### `tiered`

- `PostToolUse` records the edited file but does not run lint or surface
  anything. No per-edit context noise.
- `PostToolBatch` silently auto-fixes the edited files (controlled by
  `lintAutoFixOnBatch`).
- `SubagentStop` and `TaskCompleted` re-lint edited files at semantic
  checkpoints and surface remaining errors.
- `Stop` re-lints edited files (no transitive-dependent expansion in this mode)
  and surfaces remaining errors.

Best for long agent sessions where per-edit lint output bloats context. Errors
still surface at meaningful boundaries.

### `stop-only`

- `PostToolUse` records the edited file but does not run lint.
- `PostToolBatch` silently auto-fixes if `lintAutoFixOnBatch` is `true`.
- `SubagentStop` and `TaskCompleted` are no-ops.
- `Stop` re-lints edited files only, no transitive-dependent expansion.

Best when you only want end-of-task feedback and accept that subagents and
intermediate task completions return without surfacing lint state.

### Typecheck cadence

The typecheck hook does not honour `lintCadence`. `PostToolUse` always runs
`tsgo` on the edited file (when `typecheck` is enabled) and `Stop` always
re-runs against edited files plus their transitive dependents.

## Examples

### Default — no config file needed

Strict cadence, ESLint only, typecheck on, fix-on-edit. Equivalent to creating
`.claude/sentinel.local.md` with no frontmatter, or omitting the file entirely.

### Tiered cadence for long sessions

```yaml
---
lint-cadence: tiered
max-lint-errors: 20
---
```

Lint output stays out of the per-edit context. Errors surface at subagent stops,
task completions, and the final stop. Up to 20 error lines per surface.

### Oxlint-only, no typecheck

```yaml
---
typecheck: false
eslint: false
oxlint: true
---
```

Skips ESLint and `tsgo`; runs only Oxlint. Pair with `lint-cadence: tiered` if
you also want to suppress per-edit surfaces.

### Custom runner and extra typecheck args

```yaml
---
runner: bun x
typecheck-args: --noEmit, --strict, --pretty, false
---
```

Uses `bun x` to invoke linters and `tsgo`. The custom `typecheck-args` replaces
the default `tsgo` invocation, so include every flag you need.

### Debug a misbehaving hook

```yaml
---
debug: true
---
```

Attaches internal trace logs to `Stop` lint and `Stop` typecheck output so you
can see which files were considered, which surfaced, and what the stop-decision
returned.
