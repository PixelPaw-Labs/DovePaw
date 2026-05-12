# 8. Give agents a queryable memory layer for shared state

Date: 2026-05-12

## Status

Accepted

## Context

DovePaw agents are independent processes that finish, exit, and lose all
working state. Anything an agent needs to know across runs — what another
member of its group already decided, what it itself concluded in a prior
session, what artifact has already been produced — has to be persisted
somewhere outside the agent process and retrievable on demand.

The runtime today persists three kinds of state and treats each differently:

- **Group moments** — what members of a running group task have produced for
  one another. Written and read inside a single group session.
- **Agent state** — long-lived per-agent notes under
  `~/.dovepaw/agents/state/<agent>/`. Distilled memory, scheduled output
  state, anything an agent wants on its next run.
- **Per-task scratch** — ephemeral files inside the workspace. Dies with the
  task.

The first two are conceptually the same thing — "agent memory that survives
the current call" — but they're accessed by different ad-hoc patterns:
moments by direct `mkdir`/`writeFile`, agent state by per-agent conventions
in each script. There's no semantic query, no namespacing primitive, and no
way for one agent to ask "what was decided about X" without grepping files.

Three forces shape what we need from a memory layer:

**Semantic recall vs. universal availability.** A vector store like
OpenViking lets agents ask "what's relevant to this topic" instead of
reading every file linearly. But it requires a Python sidecar and an
embedder, both of which can be unavailable on a fresh machine. Memory
access must not break when the sidecar is missing — single-agent and
group chat both have to keep working with a degraded backend.

**Uniformity across agents and groups.** Members in a group session and a
solo agent doing its own background run both write notes they may want
later. Splitting memory APIs by context (one for "group", one for "agent
state") forces every script to know which mode it's in. A single uniform
read/write surface is easier to teach and easier to mock in tests.

**Two-process visibility.** The chatbot UI runs in Next.js. The A2A agent
servers run as a separate child process. Both touch memory. Whichever
process owns the backend lifecycle (sidecar, on-disk index, etc.) must
expose the live state so the other can discover it — without IPC.

The decision this ADR makes is: agents access shared persistent state
through one memory layer, not through ad-hoc filesystem code.

## Decision

We will give agents a queryable memory layer accessed through a single
`MemoryProvider` interface. Both group moments and (in time) per-agent
state flow through this interface. Concrete backends are pluggable — today
a semantic store (OpenViking) and a filesystem fallback (markdown); tomorrow
whatever fits.

In practice this means:

- All shared state that needs to outlive a single tool call is reached
  through `getMemoryProvider()`. Code that wants to write a moment, read a
  past decision, or seed a per-group namespace calls
  `getMemoryProvider().initGroup(...)` and
  `getMemoryProvider().buildReminder(...)`. No code path uses
  `mkdir(.../moments)` or direct `fs.writeFile` against memory locations.
- Agents read memory before they act when memory is available. The
  `<reminder>` block injected into every group member's instruction tells
  the agent how to query first (`ov find <topic>` or read
  `workspace/moments/`) and how to write second (`ov add-resource …` or
  write a markdown file). The reminder reflects the active backend so the
  same agent code works against any provider.
- Memory degrades gracefully. If a richer backend is unreachable
  (`OpenVikingMemoryProvider` boot failed, port file missing), the layer
  falls back to `MarkdownMemoryProvider` automatically. Callers do not
  branch on provider type and do not need a feature flag.
- The backend's lifecycle owner publishes its live state to a small file
  under `~/.dovepaw/` so any process can discover the active provider
  without IPC. The OpenViking sidecar lives in Next.js and writes
  `~/.dovepaw/.openviking-port.json`; A2A reads it. Any future backend
  with a similar lifecycle follows the same pattern.

Review checklist:

- New code that needs to persist or recall shared agent state calls
  `getMemoryProvider()`, not `fs/promises` directly on memory locations.
- New memory backends implement `MemoryProvider` under
  `chatbot/lib/memory/` and are wired through the registry rather than
  through bespoke top-level functions.
- Backend lifecycle code (sidecars, indexes, model loads) lives next to
  the provider it serves (`chatbot/lib/memory/<backend>.ts`), not in
  `chatbot/a2a/`.
- The MarkdownMemoryProvider fallback is reachable for any new feature —
  no code path that requires a specific backend to function.

## Consequences

**Easier:**

- Agents can be told "read past moments before acting" as a uniform rule;
  the layer figures out _how_ to read them. Adding semantic recall later
  doesn't require touching every agent script.
- Group coordination improves immediately: members query for relevant
  prior context instead of reading every file, and the namespace
  (`viking://agent/<groupContextId>/moments`) gives natural isolation
  between concurrent groups.
- Adding a new backend (Pinecone, Redis, in-memory dev stub) is a single
  file under `chatbot/lib/memory/` with no changes to call sites.
- Tests inject mock providers through `setMemoryProvider` and never need
  to touch real disk or spawn a real sidecar.
- The system stays usable when memory is degraded — single-agent chat and
  group chat both keep functioning on the markdown fallback while the
  user configures or restores the richer backend.

**Harder / trade-offs:**

- Memory now has two valid backends a developer might encounter. Bugs that
  only reproduce against one backend (e.g. `ov find` behaviour
  vs. filesystem grep semantics) require running against both. Tests cover
  both providers; manual repro may need a sidecar restart.
- Provider resolution is per-call: `getMemoryProvider()` re-reads the port
  file every time. Cheap but not free; in tight loops callers should
  resolve once and reuse.
- A reboot of the OpenViking sidecar (triggered when the user saves a new
  config in the Settings UI) invalidates any `ov` command already issued
  to the old port. The new provider is reachable immediately for the next
  call, but in-flight commands surface as errors to the agent.
- The default OpenViking embedder requires `llama-cpp-python`. Users
  picking a remote embedder via the Settings UI is the supported path; an
  un-configured fresh install runs on the markdown fallback until that
  one-time setup happens.

**Future direction (not part of this decision):**

The same interface is sized to absorb per-agent state under
`~/.dovepaw/agents/state/<agent>/`. Today each agent writes that directory
with its own ad-hoc convention. Routing it through `MemoryProvider` would
give every agent the option of semantic recall over its own history (when
a richer backend is available), a single mock surface for tests, and a
unified backup story instead of an N-per-agent one. This requires a small
interface extension so the namespace primitive accepts both group context
IDs and agent names cleanly. It is documented here so future authors
looking to add new memory features know the abstraction is intended to
absorb them.
