#!/usr/bin/env bash
# PreToolUse hook for Edit/Write — blocks repo code file edits once per session
# with the full Karpathy guidelines as permissionDecisionReason, forcing the model
# to review and acknowledge before retrying.
# sourced from https://github.com/forrestchang/andrej-karpathy-skills

REPO_ROOT="/Users/yang.liu/Envato/others/DovePaw"
INPUT=$(cat)

FILE_PATH=$(echo "$INPUT" | python3 -c \
  "import sys,json; print(json.load(sys.stdin).get('file_path',''))" 2>/dev/null || true)

# Only act on files inside the repo
[[ -z "$FILE_PATH" || "$FILE_PATH" != "$REPO_ROOT"* ]] && exit 0

# Only trigger on code files (covers major stacks)
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|\
  *.py|*.rb|*.go|*.rs|*.java|*.kt|*.kts|*.swift|*.cs|\
  *.cpp|*.cc|*.cxx|*.c|*.h|*.hpp|*.php|*.scala|\
  *.ex|*.exs|*.css|*.scss|*.sass|*.less|\
  *.html|*.htm|*.vue|*.svelte|*.sql|*.graphql|*.gql|*.tf|*.sh) ;;
  *) exit 0 ;;
esac

# Once per session: if already shown, allow
SESSION_KEY="${CLAUDE_SESSION_ID:-$$}"
SHOWN="/tmp/karpathy_shown_${SESSION_KEY}"
[ -f "$SHOWN" ] && exit 0
touch "$SHOWN"

python3 -c "
import json

reason = '''# Karpathy Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don\'t assume. Don\'t hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don\'t pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what\'s confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No \"flexibility\" or \"configurability\" that wasn\'t requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: \"Would a senior engineer say this is overcomplicated?\" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don\'t \"improve\" adjacent code, comments, or formatting.
- Don\'t refactor things that aren\'t broken.
- Match existing style, even if you\'d do it differently.
- If you notice unrelated dead code, mention it - don\'t delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don\'t remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user\'s request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- \"Add validation\" → \"Write tests for invalid inputs, then make them pass\"
- \"Fix the bug\" → \"Write a test that reproduces it, then make it pass\"
- \"Refactor X\" → \"Ensure tests pass before and after\"

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria (\"make it work\") require constant clarification.

---

Note: Review your intended edit against these guidelines, then retry when necessary.'''

print(json.dumps({
    'hookSpecificOutput': {
        'permissionDecision': 'block',
        'permissionDecisionReason': reason
    }
}))
"
