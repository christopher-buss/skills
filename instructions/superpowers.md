- Source is `vendor/superpowers/skills/`, not docs. Read existing skills as
  reference.
- Only generate skills listed in `sources/superpowers/` workflow, not all vendor
  skills.
- Some skills sync verbatim via `vendors` in meta.ts (e.g., `writing-skills`).
  Don't regenerate those.
- Keep customized skills as close to upstream as possible. Minimal diffs =
  easier upstream merges.
- Change only what's necessary: Roblox-specific examples, irrelevant web dev
  content.
- Preserve structure, headings, and ordering when possible.
- Note customizations in `GENERATION.md` so future updates know what was changed
  and why.
