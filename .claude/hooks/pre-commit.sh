#!/bin/bash
# Pre-commit hook: check format and lint; block commit if issues found.
# Claude Code will receive the block reason and must fix before retrying.

set -uo pipefail

cd "$CLAUDE_PROJECT_DIR"

ERRORS=""

# --- Format check ---
FMT_OUTPUT=$(npm run fmt:check 2>&1) || {
  ERRORS="Format issues found. Run: npm run fmt, stage the changes, then retry the commit.\n\n$FMT_OUTPUT"
}

# --- Lint check (errors only) ---
LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT=$?
if [ $LINT_EXIT -ne 0 ]; then
  if [ -n "$ERRORS" ]; then
    ERRORS="$ERRORS\n\nLint errors:\n$LINT_OUTPUT"
  else
    ERRORS="Lint errors found. Fix all issues, stage fixed files, then retry the commit.\n\n$LINT_OUTPUT"
  fi
fi

if [ -n "$ERRORS" ]; then
  printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$ERRORS" | jq -Rs .)"
  exit 0
fi

exit 0
