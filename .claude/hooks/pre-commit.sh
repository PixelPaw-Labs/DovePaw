#!/bin/bash
# Pre-commit hook: format + lint + tests run in parallel on staged files only.
# All three jobs launch concurrently; results are collected after all complete.

set -uo pipefail

cd "$CLAUDE_PROJECT_DIR"

# Claude Code passes BaseHookInput JSON on stdin; extract session_id from it
INPUT=$(cat)

# Only run for git commit commands
COMMAND=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // ""')
[[ "$COMMAND" != *"git commit"* ]] && exit 0

SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null || true)
FLAG_FILE="${TMPDIR:-/tmp}/dovepaw-tests-verified-${SESSION_ID}"

# Get staged files — nothing to check if tree is clean
STAGED_FILES=$(git diff --cached --name-only 2>/dev/null || true)
[ -z "$STAGED_FILES" ] && exit 0

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# --- Partially-staged detection (fast, run inline) ---
# Warn when a staged file also has unstaged working-tree changes.
# This catches drift caused by running `npm run fmt` or lint fixes AFTER staging —
# the staged version would be committed without the subsequent working-tree edits.
PARTIALLY_STAGED=$(git diff --name-only 2>/dev/null | while IFS= read -r f; do
  printf '%s\n' "$STAGED_FILES" | grep -qxF "$f" && printf '%s\n' "$f"
done || true)

# --- Launch format, lint, and tests in parallel ---
FMT_FILES=$(printf '%s\n' "$STAGED_FILES" | grep -E '\.(js|ts|jsx|tsx|mjs|cjs|json|jsonc|css|scss|less|html|md|yaml|yml)$' || true)
FMT_PID=""
if [ -n "$FMT_FILES" ]; then
  (printf '%s\n' "$FMT_FILES" | xargs npx oxfmt --check --no-error-on-unmatched-pattern >"$TMP/fmt.out" 2>&1) &
  FMT_PID=$!
fi

LINT_FILES=$(printf '%s\n' "$STAGED_FILES" | grep -E '\.(js|ts|jsx|tsx|mjs|cjs)$' | grep -v '^agents/' | grep -v '^\.claude/' || true)
LINT_PID=""
if [ -n "$LINT_FILES" ]; then
  (printf '%s\n' "$LINT_FILES" | xargs npx oxlint --disable-nested-config >"$TMP/lint.out" 2>&1) &
  LINT_PID=$!
fi

STAGED_TS=$(printf '%s\n' "$STAGED_FILES" | grep -E '\.(ts|tsx)$' | grep -v '^agents/' || true)
TEST_PID=""
if [ -n "$STAGED_TS" ]; then
  (printf '%s\n' "$STAGED_TS" | sed "s|^|$CLAUDE_PROJECT_DIR/|" | xargs npx vitest related --run >"$TMP/test.out" 2>&1) &
  TEST_PID=$!
fi

TSC_PID=""
if [ -n "$STAGED_TS" ]; then
  (npx tsc --noEmit >"$TMP/tsc.out" 2>&1) &
  TSC_PID=$!
fi

# --- Wait for all jobs ---
FMT_EXIT=0
if [ -n "$FMT_PID" ]; then
  wait "$FMT_PID" || FMT_EXIT=$?
fi

LINT_EXIT=0
if [ -n "$LINT_PID" ]; then
  wait "$LINT_PID" || LINT_EXIT=$?
fi

TEST_EXIT=0
if [ -n "$TEST_PID" ]; then
  wait "$TEST_PID" || TEST_EXIT=$?
fi

TSC_EXIT=0
if [ -n "$TSC_PID" ]; then
  wait "$TSC_PID" || TSC_EXIT=$?
fi

# --- Collect errors ---
ERRORS=""

if [ $FMT_EXIT -ne 0 ]; then
  ERRORS="Format issues found. Run: npm run fmt
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$(cat "$TMP/fmt.out")"
fi

if [ -n "$LINT_PID" ]; then
  LINT_OUTPUT=$(cat "$TMP/lint.out")
  if [ $LINT_EXIT -ne 0 ] || printf '%s' "$LINT_OUTPUT" | grep -qE "[1-9][0-9]* warnings? "; then
    [ -n "$ERRORS" ] && ERRORS="$ERRORS

"
    ERRORS="${ERRORS}Lint issues found. Fix each issue at the root cause — do NOT add eslint-disable comments.
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$LINT_OUTPUT"
  fi
fi

if [ $TEST_EXIT -ne 0 ]; then
  [ -n "$ERRORS" ] && ERRORS="$ERRORS

"
  ERRORS="${ERRORS}Tests failed. Fix before committing.

$(cat "$TMP/test.out")"
fi

if [ $TSC_EXIT -ne 0 ]; then
  [ -n "$ERRORS" ] && ERRORS="$ERRORS

"
  ERRORS="${ERRORS}TypeScript errors found. Fix before committing.

$(cat "$TMP/tsc.out")"
fi

if [ -n "$PARTIALLY_STAGED" ]; then
  [ -n "$ERRORS" ] && ERRORS="$ERRORS

"
  ERRORS="${ERRORS}⚠️  These staged files also have unstaged working-tree changes — the committed version will be MISSING those changes. Stage them too or discard them:

$PARTIALLY_STAGED"
fi

if [ -n "$ERRORS" ]; then
  printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$ERRORS" | jq -Rs .)"
  exit 0
fi

# --- Test reminder: confirm tests were written or updated ---
if [ -n "$SESSION_ID" ] && [ -f "$FLAG_FILE" ]; then
  rm -f "$FLAG_FILE"
  exit 0
fi

REFLECTION=$(printf '%s' "All checks pass. Did you write or update tests for the behaviour you just changed?

  If not → write the tests then in a SEPARATE Bash tool call: git add <files>, then git commit again — the hook will re-ask this question.
  If yes → run the touch command below in a SEPARATE Bash tool call, then retry the commit in another:

    touch $FLAG_FILE

  NEVER do '<command> && touch file' in a single tool call — it will make the pre-commit guardrail fail to work correctly.

  NEVER touch the flag file unless you are answering yes to the question above.
  If you modified any files since the last git commit, run git commit again first — the hook will re-ask this question.")

printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$REFLECTION" | jq -Rs .)"
exit 0
