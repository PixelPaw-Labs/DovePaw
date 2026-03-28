#!/bin/bash
# Pre-commit hook: check format and lint; block commit if issues found.
# Claude Code will receive the block reason and must fix before retrying.

set -uo pipefail

cd "$CLAUDE_PROJECT_DIR"

STAGED=$(git diff --cached --name-only)

if [ -z "$STAGED" ]; then
  exit 0
fi

ERRORS=""

# --- Format check (staged files only) ---
STAGED_FMT=$(git diff --cached --name-only -- '*.ts' '*.tsx' '*.js' '*.jsx' '*.json' '*.md')
if [ -n "$STAGED_FMT" ]; then
  FMT_OUTPUT=$(echo "$STAGED_FMT" | xargs npx oxfmt --check 2>&1) || {
    ERRORS="Format issues found. Run: npm run fmt, stage the changes, then retry the commit.\n\n$FMT_OUTPUT"
  }
fi

# --- Lint check (staged TS/JS files only) ---
STAGED_TS=$(git diff --cached --name-only -- '*.ts' '*.tsx' '*.js' '*.jsx')
if [ -n "$STAGED_TS" ]; then
  LINT_OUTPUT=$(echo "$STAGED_TS" | xargs npx oxlint 2>&1) || {
    if [ -n "$ERRORS" ]; then
      ERRORS="$ERRORS\n\nLint errors:\n$LINT_OUTPUT"
    else
      ERRORS="Lint errors found. Fix all issues, stage fixed files, then retry the commit.\n\n$LINT_OUTPUT"
    fi
  }
fi

# --- TypeScript check ---
TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || {
  if [ -n "$ERRORS" ]; then
    ERRORS="$ERRORS\n\nTypeScript errors:\n$TSC_OUTPUT"
  else
    ERRORS="TypeScript errors found. Fix all type errors, stage fixed files, then retry the commit.\n\n$TSC_OUTPUT"
  fi
}

if [ -n "$ERRORS" ]; then
  printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$ERRORS" | jq -Rs .)"
  exit 0
fi

exit 0
