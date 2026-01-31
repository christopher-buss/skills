---
description: Creates a pull request using gh CLI
argument-hint: [optional-pr-title-and-description]
---

# Create Pull Request

Create a pull request for the current branch using `gh` CLI.

## Workflow

Current branch status: !`git status`

Recent commits: !`git log --oneline -5`

Arguments: $ARGUMENTS

**Process:**

1. **Ensure Branch is Ready**: !`git status`
    - Commit all changes
    - Push to remote: `git push origin [branch-name]`

2. **Create PR**: Create a well-formatted pull request

    Title: conventional commits format, like
    `feat(open-cloud): add support for game icon uploads`

    <!--
    	Allowed (optional) scopes are package/module names or broad scopes like
    	`core`, `ui`, `character`, etc.
    -->

    Description template:

    ```markdown
    <!--
      Are there any relevant issues / PRs / mailing lists discussions?
      Please reference them here.
    -->

    ## References

    - [links to github issues referenced in commit messages]

    ## Summary

    [Brief description of changes]

    ## Test Plan

    - [ ] Tests pass
    - [ ] Manual testing completed
    ```

3. **Set Base Branch**: Default to main unless specified otherwise

4. **Link Issues**: Reference related issues found in commit messages

## Use gh CLI

1. Check current branch and ensure it's pushed
2. Use `gh pr create` with proper title and description
3. Set the base branch (default: main)
4. Include relevant issue references if found in commit messages
