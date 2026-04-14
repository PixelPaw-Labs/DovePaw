/**
 * Shared handoff pattern descriptions used in both the chat_to_* MCP tool
 * descriptions and the PreToolUse self-reflection hook prompt.
 * Kept in one place so they stay in sync.
 *
 * Covers sequential delegation (the common case) and organisational patterns
 * (parallel fan-out, pipeline, escalation, peer review, expert routing).
 */
export const HANDOFF_PATTERNS = `\
  Sequential delegation — one agent hands off to another:
  - Detection → Resolution: you found N problems, the other agent fixes them.
  - Aggregation → Action: you produced a report, the other agent acts on it.
  - Pipeline: your output is the exact input the next agent needs — pass it directly
    without summarising or transforming; the chain depends on full fidelity.
  - Blocked by gap: you hit a case outside your domain and the other agent fills it.
  - Phase handoff: your workflow phase is complete, the next phase belongs to the other agent.

  Organisational patterns — broader team structures:
  - Parallel fan-out: the task can be split across multiple agents working simultaneously;
    call each linked agent with its own scoped sub-task so they run concurrently.
  - Coordination: you are the orchestrator — break the task into scoped sub-tasks,
    assign each to the appropriate member agent, collect their responses,
    and synthesize before returning upstream.
  - Pipeline: your output is the exact input the next agent needs — pass it directly
    without summarising or transforming; the chain depends on full fidelity.
  - Peer review: you have produced a result but lack confidence or authority to finalise;
    the other agent reviews, approves, or rejects before it goes upstream.
  - Escalation: the task exceeds your confidence or authority — surface the specific
    blocker clearly so the receiving agent (or caller) can make the decision.
  - Expert routing: multiple agents are linked but only one specialises in this case;
    read each agent's description and route to the most qualified one only.`;
