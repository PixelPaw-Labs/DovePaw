# Prompt Caching and the Agent SDK

DovePaw runs every Dove turn and every sub-agent turn through the Claude Agent SDK's
`query()`. The SDK applies **prompt caching automatically** — there is no
`cache_control` to set and no cache toggle exposed through `query()`. What you _do_
control is whether the cached prefix stays byte-stable across turns. This doc explains
the mechanism and the specific things DovePaw does (and must keep doing) to hit the
cache.

## What the SDK caches

Prompt caching keys on an **exact byte-prefix match**. Claude caches a prefix of the
request and reuses it on the next turn only if the bytes are identical from the start of
the request up to the cache breakpoint. The cached region is the stable front of the
request, in this order:

```
tools  →  system  →  messages (history)
```

The first byte that differs from the previous turn is a cache miss from that point
onward. Because the regions are ordered, a change low in the hierarchy invalidates
everything after it:

| Change                                                        | Invalidates                                           |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| Tool definitions (add/remove/reorder a tool, change a schema) | `tools` + `system` + `messages` (everything)          |
| System prompt text                                            | `system` + `messages`                                 |
| New user/assistant message                                    | `messages` only (normal — this is the per-turn delta) |

The raw Messages API exposes `cache_control: {"type": "ephemeral"}` on the last tool to
mark the breakpoint. **The Agent SDK does this for you** — see
[Tool use with prompt caching](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching).
There is currently no public knob to control breakpoints from the SDK
([claude-agent-sdk-typescript#89](https://github.com/anthropics/claude-agent-sdk-typescript/issues/89)),
so the only lever DovePaw has is **prefix stability**.

## Where DovePaw's prefix comes from

Both the `tools` block and the `system` block are built per request in
`chatbot/app/api/chat/route.ts`, and both iterate the **same agent list** returned by
`readAgentsConfig()`:

- **Tools** — `route.ts` maps every agent into its `ask_/start_/await_` trio
  (`agents.flatMap(...)`). The trio's order follows the agent list order.
- **System prompt** — `buildSystemPrompt()` renders the `<agents>` block by mapping over
  the same list, and interpolates the live `{agentCount}`.

So the agent list order feeds **two** prefix regions at once. If that order is unstable,
the prefix changes even when nothing about the roster actually changed — a needless cache
miss on every turn.

## What we do to hit the cache

### 1. Deterministic agent ordering

`readAllAgentFiles()` (`lib/agents-config.ts`) sorts agent directories by name before
reading them:

```ts
const dirs = entries
  .filter((d) => d.isDirectory())
  .toSorted((a, b) => a.name.localeCompare(b.name));
const results = await Promise.all(dirs.map((d) => readAgentFile(d.name)));
```

Previously the order came straight from `readdir`, which is filesystem-dependent and not
contractually stable. With the sort, an unchanged roster produces a byte-identical
`tools` block and `<agents>` list on every turn. This is covered by the
`readAgentConfigEntries — deterministic ordering` test in
`lib/__tests__/agents-config.test.ts`.

> Side benefit: the sidebar agent list is now deterministic too, since it reads from the
> same source.

### 2. A single system-prompt string

The system prompt is passed as one preset with a single `append` string
(`route.ts`, `systemPrompt: { type: "preset", preset: "claude_code", append: ... }`).
Keep it one composed string. Do **not** split it into multiple `system` blocks — the
SDK's auto-breakpoint logic places `cache_control` per block and can trip the
4-breakpoint limit, surfacing as a `400` about `cache_control` blocks
([claude-agent-sdk-typescript#311](https://github.com/anthropics/claude-agent-sdk-typescript/issues/311)).

### 3. Dove's tools do not filter by online status

Dove's tool list is built from the full roster regardless of whether each agent's A2A
server is up. This is deliberate: an agent's server flapping online/offline mid-conversation
does **not** change Dove's `tools` block, so it does not bust the cache. (Sub-agents differ
— see below.)

## What legitimately busts the cache (and should)

These are correct misses — the prompt genuinely changed, so reuse would be wrong:

- **Installing or uninstalling an agent.** `{agentCount}` and the `<agents>` list change,
  and the `tools` block gains/loses a trio. The prefix is genuinely different.
- **Changing Dove's persona/tagline/model** in settings — these feed the system prompt or
  request params.

The deterministic sort does not (and should not) prevent these. Its job is narrow:
**don't bust the cache when nothing actually changed.**

## Caveat: sub-agent linked tools

Sub-agents (`chatbot/a2a/lib/query-agent-executor.ts`) resolve their linked-agent tools
fresh on every `execute()` via `resolveLinkedTools()`, which **filters by online status**
(`resolveAgentPort()`). On a _resumed_ sub-agent session, if a linked agent goes online or
offline between turns, the sub-agent's `tools` block changes and its cache is invalidated
for the rest of the session.

This is a deliberate trade-off — you want offline agents excluded from a sub-agent's tool
surface — not a bug. Just be aware that sub-agent cache hit rates are inherently more
sensitive to link/heartbeat churn than Dove's.

## Summary

- The SDK caches automatically; you cannot set `cache_control` through `query()`.
- The only lever is keeping the `tools` → `system` prefix byte-stable across turns.
- DovePaw achieves this with deterministic agent ordering, a single system-prompt string,
  and not filtering Dove's tools by online status.
- Roster/settings changes busting the cache is correct behaviour.
- Sub-agent linked tools filter by online status, so their cache is more churn-sensitive
  by design.
