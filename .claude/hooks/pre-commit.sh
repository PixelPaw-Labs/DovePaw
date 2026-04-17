#!/bin/bash
# Pre-commit hook: format + lint staged files directly; run related tests via `vitest related`.
#
# Format and lint run directly on staged files only — not the whole codebase.
# Tests run via `vitest related <files>` which traces the import graph from staged source files.

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

ERRORS=""

# --- Format check (staged files only) ---
# oxfmt handles JS/TS/JSX/TSX/JSON/CSS/MD and more; skip unrecognised extensions.
FMT_FILES=$(printf '%s\n' "$STAGED_FILES" | grep -E '\.(js|ts|jsx|tsx|mjs|cjs|json|jsonc|css|scss|less|html|md|yaml|yml)$' || true)
if [ -n "$FMT_FILES" ]; then
  FMT_OUTPUT=$(printf '%s\n' "$FMT_FILES" | xargs npx oxfmt --check 2>&1) || {
    ERRORS=$(printf '%s' "Format issues found. Run: npm run fmt
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$FMT_OUTPUT")
  }
fi

# --- Lint check (staged JS/TS files only, skip agents/) ---
if [ -z "$ERRORS" ]; then
  LINT_FILES=$(printf '%s\n' "$STAGED_FILES" | grep -E '\.(js|ts|jsx|tsx|mjs|cjs)$' | grep -v '^agents/' || true)
  if [ -n "$LINT_FILES" ]; then
    LINT_OUTPUT=$(printf '%s\n' "$LINT_FILES" | xargs npx oxlint --disable-nested-config 2>&1)
    LINT_EXIT=$?
    if [ $LINT_EXIT -ne 0 ] || printf '%s' "$LINT_OUTPUT" | grep -qE "[1-9][0-9]* warnings? "; then
      ERRORS=$(printf '%s' "Lint issues found. Fix each issue at the root cause — do NOT add eslint-disable comments.
⚠️  Run: git diff --name-only to see which files the fix changed, then stage ONLY those files in a SEPARATE Bash tool call: git add <only the files changed by the fix above — NOT other unrelated unstaged files>
Then retry the commit in another Bash tool call.

$LINT_OUTPUT")
    fi
  fi
fi

if [ -n "$ERRORS" ]; then
  printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$ERRORS" | jq -Rs .)"
  exit 0
fi

# --- Test gate: run related tests via import graph ---
STAGED_TS=$(printf '%s\n' "$STAGED_FILES" | grep -E '\.(ts|tsx)$' | grep -v '^agents/' || true)

if [ -n "$STAGED_TS" ]; then
  TEST_OUTPUT=$(printf '%s\n' "$STAGED_TS" | sed "s|^|$CLAUDE_PROJECT_DIR/|" | xargs npx vitest related --run 2>&1)
  TEST_EXIT=$?
  if [ $TEST_EXIT -ne 0 ]; then
    printf '{"decision": "block", "reason": %s}' \
      "$(printf 'Tests failed. Fix before committing.\n\n%s' "$TEST_OUTPUT" | jq -Rs .)"
    exit 0
  fi
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

  NEVER touch the flag file unless you are answering yes to the question above.
  If you modified any files since the last git commit, run git commit again first — the hook will re-ask this question.")

printf '{"decision": "block", "reason": %s}' "$(printf '%s' "$REFLECTION" | jq -Rs .)"
exit 0
