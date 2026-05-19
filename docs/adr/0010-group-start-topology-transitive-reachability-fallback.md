# 10. Group start topology: transitive-reachability fallback when no DAG root exists

Date: 2026-05-19

## Status

Accepted

## Context

`makeStartGroupTool` in `chatbot/lib/group-tools.ts` determines which member
agents are eligible to be auto-started when a group is invoked. It does so by
inspecting the group's chat-strategy link subgraph and classifying each member
by its degree:

- **Preferred** (outDeg > 0, inDeg = 0) — true DAG roots: agents that hand off
  to others but receive no handoffs themselves. These are natural entry points
  and are presented as the exclusive candidate list.
- **Fallback** (outDeg = 0, inDeg = 0) — isolated nodes: agents with no links
  at all.

When `preferred` is empty, the old code fell back to the isolated-node set. This
had two failure modes:

**Correct but uninformed selection (no links).** When a group has no links
configured at all, every member scores 0/0 and the full roster is presented as
fallback. The LLM picks freely based on relevance scores alone. This produced
the EC-12077 incident: when investigating a Jira ticket to produce GA team
questions, the LLM scored `codebase-analyst` at 92 and dispatched it before
reading the ticket — reversing the correct discovery → analysis order.

**Silent exclusion of connected nodes (partial links, no pure root).** When
links exist but every node has both incoming and outgoing edges — common in
bidirectional or cyclic topologies — neither bucket matches any member. The
`buckets` string rendered empty, giving the LLM no roster at all and bypassing
the eligibility gate entirely.

The root cause in both cases is the same: the isolated-node fallback ignores
topology. A node with no links cannot be distinguished from a node that is
actually a well-connected hub, and the LLM's relevance scoring is not a reliable
substitute for structural ordering.

## Decision

We will replace the isolated-node fallback with a **transitive-reachability
fallback**. When `preferred` is empty, the algorithm computes a reachability
score for every member and presents those with the maximum score as candidates.

Reachability is defined recursively: `reach(n) = Σ (1 + reach(t))` for each
direct target `t` of `n`, with a visited-set guard to terminate cycles. The
adjacency list expands `direction: "dual"` links in both directions, so a mutual
link between two agents contributes to both their scores symmetrically.

If all reachability scores are 0 — meaning no chat links exist in the group at
all — every member ties at 0 and the full roster is presented. This preserves
the previous behaviour for unlinked groups while improving behaviour as soon as
any links are added.

The implementation lives entirely in `makeStartGroupTool`
(`chatbot/lib/group-tools.ts`). The `preferred` calculation is unchanged; only
the fallback path is replaced. The `buckets` conditional simplifies from a
nested ternary to a single binary choice between `preferred` and the
reachability-ranked `fallback`.

Review checklist:

- The `preferred` condition (`outDeg > 0 && inDeg === 0`) must not change. It
  is the primary gate and its semantics are correct for true DAG roots.
- The adjacency list built for reachability must expand `direction: "dual"` links
  in both directions — the same expansion applied to `outDeg`/`inDeg` — so
  bidirectional links are treated consistently between the two paths.
- The visited-set passed to `reachability()` must be per-call (not shared across
  members). Each member's score is an independent DFS from that member's node.
- When `preferred` is non-empty, `fallback` and `reachMap` are never consulted.
  The reachability computation is O(V + E) and is cheap, but the candidate list
  presented to the LLM must still be `preferred` only in that case.
- Adding a new group to the system: if the group's links are not yet configured,
  all members tie at reachability 0 and the full roster is presented — this is
  intentional and expected while a group is being set up. Once links are
  configured, the highest-reach subset will become the effective fallback
  automatically, without any code change.

## Consequences

**Easier:**

- Groups with bidirectional or cyclic topologies — where no pure DAG root exists
  — now produce a meaningful candidate list instead of an empty bucket. The LLM
  is always presented with the most structurally central agents as starting
  points, not an arbitrary or empty set.
- Discovery agents (e.g. `jira-ticket-viewer`, `slack-explorer`) configured with
  outgoing links to analysis agents (e.g. `codebase-analyst`, `datadog-analyser`)
  naturally emerge as the reachability leaders, even when they also link to each
  other bidirectionally. The structural ordering matches the intended
  investigation sequence without requiring explicit configuration of pure DAG
  topology.
- Groups with no links at all behave identically to before. There is no
  behaviour regression for existing unlinked groups.

**Harder / trade-offs:**

- The reachability score is a DFS over the link graph. For groups with many
  members and dense links, the computation visits every reachable node once per
  member. Worst case is O(members × (V + E)). At the scale of current groups
  (≤ 15 members, sparse links) this is negligible, but it should be revisited if
  groups grow substantially larger.
- The fallback is still a heuristic. It ranks by topology, not by task context.
  A group where all members are equally well-connected (all tie at the same
  maximum reachability) will still present the full tied set to the LLM, and
  relevance scoring determines the final pick. Configuring explicit preferred
  entry points via links remains the authoritative way to constrain dispatch
  order.
- The visible behaviour change only affects groups where `preferred` is empty. If
  a group currently relies on the isolated-node fallback to present a specific
  subset of agents (those with no links), adding any links to those agents will
  now shift them into the reachability ranking instead. Groups should be audited
  after adding new links to confirm the new fallback set is still the intended
  one.
