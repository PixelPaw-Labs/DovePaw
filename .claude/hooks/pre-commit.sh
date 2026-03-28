#!/bin/bash
# Pre-commit hook: check format, lint, types, tests; block commit if issues found.
# Claude Code will receive the block reason and must fix before retrying.

set -uo pipefail

cd "$CLAUDE_PROJECT_DIR"

# Read session_id from stdin (Claude Code passes BaseHookInput JSON)
INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
FLAG_FILE="${TMPDIR:-/tmp}/dovepaw-tests-verified-${SESSION_ID}"

ERRORS=""

# --- Format check ---
FMT_OUTPUT=$(npm run fmt:check 2>&1) || {
  ERRORS="Format issues found. Run: npm run fmt, stage the changes, then retry the commit.\n\n$FMT_OUTPUT"
}

# --- Lint check ---
LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT=$?
if [ $LINT_EXIT -ne 0 ] || echo "$LINT_OUTPUT" | grep -qE "[1-9][0-9]* warnings? "; then
  if [ -n "$ERRORS" ]; then
    ERRORS="$ERRORS\n\nLint issues:\n$LINT_OUTPUT"
  else
    ERRORS="Lint issues found. Fix each issue properly at the root cause — do NOT add eslint-disable comments or suppress rules. Fix and stage the changes, then retry the commit.\n\n$LINT_OUTPUT"
  fi
fi

# --- TypeScript check ---
TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || {
  if [ -n "$ERRORS" ]; then
    ERRORS="$ERRORS\n\nTypeScript errors:\n$TSC_OUTPUT"
  else
    ERRORS="TypeScript errors found. Fix all type errors properly at the root cause. Fix and stage the changes, then retry the commit.\n\n$TSC_OUTPUT"
  fi
}

if [ -n "$ERRORS" ]; then
  printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$ERRORS" | jq -Rs .)"
  exit 0
fi

# --- Test check ---
TEST_OUTPUT=$(npm run chatbot:test 2>&1)
TEST_EXIT=$?
if [ $TEST_EXIT -ne 0 ]; then
  REASON="Tests are failing. Fix the tests properly — do NOT skip or disable them — stage the changes, then retry the commit.\n\n$TEST_OUTPUT"
  printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$REASON" | jq -Rs .)"
  exit 0
fi

# --- Self-reflection gate ---
# If the session-scoped flag exists, Claude already confirmed tests — allow and consume it.
if [ -n "$SESSION_ID" ] && [ -f "$FLAG_FILE" ]; then
  rm -f "$FLAG_FILE"
  exit 0
fi

# Block and prompt self-reflection. To bypass after confirming, run:
#   touch <flag_file>
# then retry the commit.
REFLECTION="All checks pass. Ask yourself: did you write or update tests for the behaviour you just changed?\n\n  If not → write the tests, stage them, and retry.\n  If yes → run this command to confirm, then retry the commit:\n\n    touch $FLAG_FILE"
printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$REFLECTION" | jq -Rs .)"
exit 0
