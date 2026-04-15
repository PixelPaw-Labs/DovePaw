# 3. Inject Karpathy guidelines via SessionStart hook additionalContext

Date: 2026-04-15

## Status

Accepted

## Context

Behavioural coding guidelines (think before coding, simplicity first, surgical changes,
goal-driven execution) are valuable guardrails against common LLM mistakes. The obvious
place to put them is `CLAUDE.md` or a memory file — both are loaded automatically and
persist without maintenance.

The problem is **instruction fatigue from context distance**. `CLAUDE.md` is injected at
the top of the system prompt, before all project files, memory entries, tool schemas, and
conversation history. By the time the model reaches the user's actual message, hundreds or
thousands of tokens of higher-priority context have accumulated between the guidelines and
the request. Generic instructions placed far from the user message are routinely overridden
by more specific, more recent context — particularly by detailed CLAUDE.md rules, memory
entries, and skill prompts that address the concrete task at hand.

Claude Code's `SessionStart` hook supports an `additionalContext` field that injects
content as a `<system-reminder>` block. This block is inserted immediately before the
first user message — the closest possible position to the actual request, after all
CLAUDE.md and memory files have been loaded. Instructions at this position benefit from
recency and are not buried under prior context.

## Decision

Karpathy guidelines are delivered via a `SessionStart` hook
(`.claude/hooks/karpathy-guidelines.sh`) that emits `additionalContext`. This places the
guidelines at the end of the context window, immediately adjacent to the first user
message, rather than at the top of the system prompt.

The hook propagates to **sub-agent workspace clones** automatically.
`writeWorkspacePermissions()` (`chatbot/a2a/lib/workspace.ts`) copies the hook from
`KARPATHY_HOOK_SRC` (`lib/paths.ts`) into `<clonePath>/.claude/hooks/karpathy-guidelines.sh`
and registers it as a `SessionStart` hook in `<clonePath>/.claude/settings.local.json`
alongside the workspace Write/Edit permission grants. This ensures every nested Claude Code
invocation spawned by an agent script inside a workspace clone also receives the guidelines
at session start.

This hook is **not** duplicated in `CLAUDE.md` or memory. The two delivery mechanisms
target different positions in the context window and would conflict: having both dilutes
the recency advantage by also providing an earlier, lower-weight copy that the later copy
must override.

## Consequences

**Better:**

- Guidelines are read last, closest to the user message — maximum recency weight.
- They are not drowned out by the accumulated context of CLAUDE.md rules, memory entries,
  and skill prompts that sit earlier in the window.
- The injection point is consistent: always the same distance from the first user message
  regardless of how large the project's CLAUDE.md or memory grows.

**Trade-offs:**

- Every session pays the token cost (~500 tokens) even for trivial one-liner tasks. The
  hook itself acknowledges this: _"These guidelines bias toward caution over speed. For
  trivial tasks, use judgment."_ The cost multiplies across the pipeline: each sub-agent
  workspace clone session pays the same overhead independently.
- The hook must be maintained as a shell script and re-deployed to each machine. It is not
  automatically inherited by teammates who clone the repo (`.claude/hooks/` is gitignored
  except `settings.json`). Sub-agent workspace propagation is automatic because
  `writeWorkspacePermissions()` copies it at runtime from the DovePaw project directory.
- `additionalContext` is a `system-reminder`, not a first-class system prompt directive.
  It is advisory: the model may still deviate under strong task-specific pressure.
