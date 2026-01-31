---
allowed-tools:
    Bash(git diff:*), Bash(git status:*), Bash(git log:*), Bash(git
    rev-parse:*), Bash(git merge-base:*), Bash(git branch:*)
description:
    Code review for roblox-ts projects using dynamic category detection and
    game-specific analysis
argument-hint: (optional) [branch, PR#, or PR URL] - defaults to current branch
---

# Code Review

Perform a code review using dynamic category detection for roblox-ts projects.

## Phase 0: Setup & Categorization

### Determine What to Review

Parse the argument to determine the review target:

| Input                                                   | Action                                           |
| ------------------------------------------------------- | ------------------------------------------------ |
| No argument                                             | Detect divergence point, confirm scope with user |
| Branch name                                             | Use specified branch as base                     |
| PR number (e.g., `123`)                                 | Fetch PR diff from GitHub                        |
| PR URL (e.g., `https://github.com/owner/repo/pull/123`) | Extract PR number and fetch diff                 |

**For GitHub PRs:**

1. Use `gh` CLI to fetch the diff: `gh pr diff <number>`
2. If the command fails, report error and stop

**For local branches (no argument or branch name provided):**

1. **Get current branch**: `git rev-parse --abbrev-ref HEAD`

2. **Check for uncommitted changes**: `git status --porcelain`
    - If output is non-empty, note that uncommitted changes exist

3. **Detect divergence point** (skip if branch name was provided as argument):
    - Get all local branches except current:
      `git branch --format='%(refname:short)'`
    - For each branch, find merge-base: `git merge-base HEAD <branch>`
    - Count commits from merge-base to HEAD:
      `git rev-list --count <merge-base>..HEAD`
    - The branch with the **fewest commits back** (closest merge-base) is the
      likely parent
    - If no other branches exist, fall back to `main`, `master`, or `develop` if
      they exist as remote tracking branches

4. **Confirm scope with user** using `AskUserQuestion`:

    **Question 1 - "Review scope"** (header: "Base branch"):
    - Option A: `From <detected-branch>` — "Review N commits since diverging
      from <branch>"
    - Option B: `Different branch` — "Specify another branch to compare against"
    - Option C: `Uncommitted only` — "Review only staged/unstaged changes, skip
      committed work"

    **Question 2 - "Include uncommitted?"** (header: "Uncommitted", only ask if
    uncommitted changes exist AND user didn't pick option C):
    - Option A: `Yes` — "Include N staged/unstaged files in review"
    - Option B: `No` — "Review only committed changes"

5. **Collect changed files** based on user selection:
    - From branch: `git diff --name-only <base>...HEAD`
    - Uncommitted unstaged: `git diff --name-only`
    - Uncommitted staged: `git diff --name-only --cached`
    - Combine and deduplicate the file list

6. **If no changes**: Report "Nothing to review" and stop

### Categorize Files

Check for CLAUDE.md - if it exists, note any project-specific review patterns.

Categorize each changed file into ONE primary category based on these patterns:

| Category       | File Patterns                                                                        |
| -------------- | ------------------------------------------------------------------------------------ |
| Client/UI      | `client/`, `*.story.tsx`, `*ui*`, `*screen*`, `*hud*`, Roact/React components        |
| Client/Input   | `*input*`, `*controller*`, `*keybind*`, `*action*` in client context                 |
| Server/Service | `server/`, `*service*`, `*manager*`, game logic running on server                    |
| Networking     | `*remote*`, `*network*`, `*replication*`, RemoteEvent/RemoteFunction usage           |
| ECS/Systems    | `*system*`, `*component*`, `*world*`, `*query*`, `*entity*`, ECS patterns            |
| Data/State     | `*store*`, `*data*`, `*profile*`, `*save*`, DataStore usage, state management        |
| Shared         | `shared/`, types, utilities, constants used by both client and server                |
| Tooling/Config | `*.config.*`, `package.json`, `tsconfig.*`, `default.project.json`, `*.project.json` |
| CI/CD          | `.github/`, `aftman.toml`, `wally.toml`, `selene.toml`, `stylua.toml`                |
| Tests          | `*.spec.*`, `*test*`, `__tests__/`                                                   |
| Docs           | `*.md`, `docs/`, `README*`, `CHANGELOG*`                                             |

Output the categorization:

```text
## Categorization

Base branch: <branch>
Total files changed: <n>

| Category | Files |
|----------|-------|
| <category> | <count> |
...
```

## Phase 1: Branch Brief

From the diff and recent commit messages (`git log <base>...HEAD --oneline`),
infer:

- **Goal**: What this branch accomplishes (1-3 sentences)
- **Constraints**: Any implied requirements (security, performance, backwards
  compatibility)
- **Success checklist**: What must work after this change, what must not break

```text
## Branch Brief

**Goal**: ...
**Constraints**: ...
**Checklist**:
- [ ] ...
```

## Phase 2: Category Reviews

For each detected category with changes, run a targeted review. Skip categories
with no changes.

### Client/UI Review Criteria

- Component patterns: React-Lua composition, proper cleanup on unmount
- Memory management: Connection cleanup, Instance references held too long
- Performance: Avoiding re-renders, proper use of hooks/bindings
- Accessibility: Controller support, readable UI scaling

### Client/Input Review Criteria

- Platform support: Keyboard, gamepad, touch, mobile considerations
- State management: Input buffering, action queueing
- Conflicts: Overlapping keybinds, modal input handling

### Server/Service Review Criteria

- Exploit prevention: Never trust client data, validate all RemoteEvent args
- Rate limiting: Protect against remote spam
- Authorization: Player permission checks before actions
- Memory management: Cleanup on player leave, avoiding memory leaks

### Networking Review Criteria

- Remote validation: Use `typeIs`/`@rbxts/t` to validate all client args as
  `unknown`
- Bandwidth: Avoid sending unnecessary data, batch updates where possible
- Security: Never expose sensitive data to clients, server authority
- Timing: Handle network latency, avoid race conditions

### ECS/Systems Review Criteria

- Query efficiency: Avoid overly broad queries, cache query results when
  appropriate
- Component design: Small, focused components with single purpose
- System ordering: Dependencies between systems handled correctly
- Cleanup: Entities properly despawned, components removed

### Data/State Review Criteria

- DataStore safety: Proper error handling, retry logic, session locking
- Data migration: Backwards compatibility with existing player data
- Rate limits: Respect DataStore request limits
- Atomicity: Related data changes happen together

### Shared Review Criteria

- Type safety: No `any` types, proper generic constraints
- roblox-ts patterns: Use `typeIs`/`classIs` for runtime checks, proper DataType
  math
- Constants: Magic numbers extracted, enums over string literals
- Utilities: Pure functions, no side effects

### Tooling/Config Review Criteria

- Breaking changes: Does this affect developer workflow?
- Dependency compatibility: Version conflicts, roblox-ts compatibility
- Build: Rojo project structure, path mappings correct

### CI/CD Review Criteria

- Secrets exposure: API keys, place IDs in logs
- Linting: Selene/Stylua configuration, ESLint rules
- Workflow: Build verification, deployment safety

### Tests Review Criteria

- Coverage: Edge cases, error paths, boundaries
- Mocking: Proper service mocks, no real DataStore calls
- Isolation: Tests don't depend on each other

### Docs Review Criteria

- Technical accuracy: Code examples work, APIs documented correctly
- Completeness: All new features documented
- Clarity: Easy to follow, good examples

**Output format per category:**

```text
## <Category> Review (<n> files)

### file:line - [blocker|risky|nit] Title
Description of the issue and why it matters.
Suggested fix or question to investigate.

...
```

## Phase 3: Cross-Cutting Analysis

After reviewing all categories, check for cross-cutting issues:

- Remote added but args not validated on server?
- Server service changed but client still sends old data format?
- New feature but no player data migration?
- Shared types changed but client/server not updated?
- Network-sensitive code without rate limiting?

```text
## Cross-Cutting Issues

- [ ] <issue description>
...
```

## Phase 4: Summary

### PR Description (draft)

Provide a ready-to-paste PR description:

```text
## What changed
- <by category, 1-2 bullets each>

## Why
- <motivation>

## Testing
- <how to test in Studio>

## Notes
- <data migration, breaking changes, etc.>
```

### Review Checklist

```text
## Before Merge

### Blockers (must fix)
- [ ] ...

### Risky (highlight to reviewers)
- [ ] ...

### Follow-ups (can defer)
- [ ] ...
```

---

Review target (branch name, PR number, or PR URL - leave empty for current
branch): $ARGUMENTS
