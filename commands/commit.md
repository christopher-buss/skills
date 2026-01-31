---
description: Create a git commit following project standards
argument-hint: [optional-commit-description]
model: claude-haiku-4-5
---

Create a git commit following project standards

Include any of the following info if specified: $ARGUMENTS

## Commit Message Rules

Follows [Conventional Commits](https://www.conventionalcommits.org/) standard.

1. **Format**: `type(scope): description`
    - Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`,
      `style`, `ci`
    - Scope: The primary package/module effected (e.g., `cli`, `open-cloud`,
      `website`). When working in monorepos, this is the name of the package.
      When not applicable, omit the scope (e.g., `docs: update README`). When in
      single-package repos, prefer broad scopes (e.g. `core`, `ui`)
    - Description: Brief summary of changes (max 72 characters), always
      lowercase, no period at end. Split PascalCase with hyphens (e.g.,
      `Add UserAuth` -> `add user-auth`).

2. **Content**: Write clear, concise commit messages describing what changed and
   why. Use imperative mood (e.g., "Add feature" not "Added feature" or "Adds
   feature").

## Process

1. Run `git status` and `git diff` to review changes
2. Run `git log --oneline -5` to see recent commit style
3. Stage relevant files with `git add`
4. Create commit with descriptive message
5. Verify with `git status`

## Example

```bash
git add <files>
git commit -m "feat(ui): implement dark mode support

Improves user experience by adding dark mode option in settings.

Closes #123
"
```
