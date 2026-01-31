#!/usr/bin/env bash
set -euo pipefail

# Parse hook input - store in temp file to avoid shell escaping issues
tmp_input=$(mktemp)
cat > "$tmp_input"
file_path=$(jq -r '.tool_input.file_path // empty' < "$tmp_input" 2>/dev/null || echo "")
rm -f "$tmp_input"

# Exit early if no file path
[[ -z "$file_path" ]] && exit 0

# Only process TypeScript files
[[ "$file_path" =~ \.(ts|tsx)$ ]] || exit 0

# Run eslint_d with --fix silently
eslint_output=$(ESLINT_IN_EDITOR=true eslint_d --cache --fix "$file_path" 2>&1 || true)

# Check if ESLint found unfixable errors
if echo "$eslint_output" | grep -qi "error"; then
	# Extract only error lines (first 5)
	errors=$(echo "$eslint_output" | grep -i "error" | head -5)

	# Output minimal JSON context for Claude
	jq -n \
		--arg errors "$errors" \
		--arg filepath "$file_path" \
		'{
			hookSpecificOutput: {
				hookEventName: "PostToolUse",
				additionalContext: ("⚠️ Lint errors in " + $filepath + ":\n" + $errors)
			}
		}'
	exit 0
fi

# Restart eslint_d async to clear cache for next run
nohup eslint_d restart </dev/null >/dev/null 2>&1 &
disown

exit 0
