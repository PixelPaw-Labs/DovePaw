#!/bin/bash
# Pre-commit hook: check format, lint, types, tests; block commit if issues found.
# Claude Code will receive the block reason and must fix before retrying.

set -uo pipefail

cd "$CLAUDE_PROJECT_DIR"

# Claude Code passes BaseHookInput JSON on stdin; extract session_id from it
INPUT=$(cat)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
FLAG_FILE="${TMPDIR:-/tmp}/dovepaw-tests-verified-${SESSION_ID}"

ERRORS=""

# --- Format check ---
FMT_OUTPUT=$(npm run fmt:check 2>&1) || {
  ERRORS=$(cat <<EOF
Format issues found. Run: npm run fmt
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$FMT_OUTPUT
EOF
)
}

# --- Lint check ---
LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT=$?
if [ $LINT_EXIT -ne 0 ] || echo "$LINT_OUTPUT" | grep -qE "[1-9][0-9]* warnings? "; then
  if [ -n "$ERRORS" ]; then
    ERRORS=$(cat <<EOF
$ERRORS

Lint issues:
$LINT_OUTPUT
EOF
)
  else
    ERRORS=$(cat <<EOF
Lint issues found. Fix each issue at the root cause — do NOT add eslint-disable comments.
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$LINT_OUTPUT
EOF
)
  fi
fi

# --- TypeScript check ---
TSC_OUTPUT=$(npx tsc --noEmit 2>&1) || {
  if [ -n "$ERRORS" ]; then
    ERRORS=$(cat <<EOF
$ERRORS

TypeScript errors:
$TSC_OUTPUT
EOF
)
  else
    ERRORS=$(cat <<EOF
TypeScript errors found. Fix all type errors at the root cause.
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$TSC_OUTPUT
EOF
)
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
  REASON=$(cat <<EOF
Tests are failing. Fix the tests properly — do NOT skip or disable them.
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$TEST_OUTPUT
EOF
)
  printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$REASON" | jq -Rs .)"
  exit 0
fi

# --- Self-reflection gate ---
# Flag must be set explicitly by Claude (separate Bash call) to confirm tests were written.
# The hook never sets the flag itself — only Claude can, after consciously answering "yes".
if [ -n "$SESSION_ID" ] && [ -f "$FLAG_FILE" ]; then
  rm -f "$FLAG_FILE"
  exit 0
fi

REFLECTION=$(cat <<EOF
All checks pass. Did you write or update tests for the behaviour you just changed?

  If not → write the tests then in a SEPARATE Bash tool call: git add <files>, then git commit again — the hook will re-ask this question.
  If yes → run the touch command below in a SEPARATE Bash tool call, then retry the commit in another:

    touch $FLAG_FILE

  NEVER touch the flag file unless you are answering yes to the question above.
  If you modified any files since the last git commit, run git commit again first — the hook will re-ask this question.
EOF
)
printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$REFLECTION" | jq -Rs .)"
exit 0
