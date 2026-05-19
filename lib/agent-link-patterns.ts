/**
 * Scope-alignment check — run this before any handoff, review, or escalation.
 *
 * The current task context must overlap with the target agent's stated domain.
 * Being linked does not imply relevance — the link represents a possible
 * connection, not a guarantee that this specific task requires it.
 */
export function SCOPE_CHECK(agentName = "the target agent"): string {
  return `Before calling ${agentName}, answer these two questions:

  1. **What is the scope of the current task?**
     Re-read the original instruction. Identify the domain: backend, frontend,
     infra, data, security, etc.
     <example>"fix the API response" is backend; "update the button label" is frontend.</example>

  2. **Does ${agentName}'s description match that scope?**
     Read their description word-for-word. If the current task's domain does not
     appear in their description, do not call — even if they are linked.

  Only proceed if both answers align. A link means "these agents can cooperate";
  it does not mean "always involve both". Irrelevant handoffs create noise,
  wasted work, and confusion for the receiving agent.`;
}

/**
 * Shared handoff guidance used in both the chat_to_* MCP tool descriptions
 * and the PreToolUse self-reflection hook prompt.
 * Kept in one place so they stay in sync.
 *
 * @param agentName - Display name of the target agent. Defaults to "the target agent"
 *   for contexts where no specific agent is named (e.g. reflection prompts).
 */
export function HANDOFF_PATTERNS(agentName = "the target agent"): string {
  return `${SCOPE_CHECK(agentName)}

When:

✅ You have finished your own work and produced concrete, actionable output — a
  list of issues, a diff, a report, a set of IDs — that ${agentName} is built
  to act on. The handoff has substance.

✅ The workflow explicitly continues into ${agentName}'s domain. Recognise
  these generic handoff patterns:

  Sequential delegation — one agent hands off to another:
  - Detection → Resolution: you found N problems, the other agent fixes them.
  - Aggregation → Action: you produced a report, the other agent acts on it.
  - Blocked by gap: you hit a case outside your domain and the other agent fills it.
  - Phase handoff: your workflow phase is complete, the next phase belongs to the other agent.

  Organisational patterns — broader team structures:
  - Parallel fan-out: the task can be split across multiple agents working simultaneously;
    call each linked agent with its own scoped sub-task so they run concurrently.
  - Coordination: you are the orchestrator — break the task into scoped sub-tasks,
    assign each to the appropriate member agent, collect their responses,
    and synthesize before returning upstream.
  - Peer review: you have produced a result but lack confidence or authority to finalise;
    the other agent reviews, approves, or rejects before it goes upstream.
  - Escalation: the task exceeds your confidence or authority — surface the specific
    blocker clearly so the receiving agent (or caller) can make the decision.
  - Expert routing: multiple agents are linked but only one specialises in this case;
    read each agent's description and route to the most qualified one only.

✅ ${agentName} needs information you possess (findings, context, a prior
  session contextId) that it cannot obtain itself without re-doing your work.

✅ The result matters to the current task — without ${agentName}'s response,
  your task is incomplete or its output is unverified.

When not:

❌ Your own work is not yet done. Always finish and verify your output first,
  then hand off. Incomplete handoffs create cascading failures.

❌ You found nothing actionable — zero issues, empty results, no failures. If
  there is nothing to hand off, do not call.

❌ The scope check above failed — the current task domain does not match
  ${agentName}'s specialisation. Being linked is not a reason to call.

❌ You are speculating or being cautious. "It might be useful to also ask
  ${agentName}" is not a trigger. Concrete output is the trigger.

❌ The instruction you would send is vague: "please help", "check this", "take
  a look". If you cannot write a specific, complete instruction, you are not
  ready to hand off.

❌ Calling would duplicate **execution work** ${agentName} already completed
  this session — e.g. the agent already fixed the bug, ran the migration, or
  produced the same report. Do not re-run identical work.
  Exception: in discussion, brainstorming, or collaborative prediction tasks,
  calling ${agentName} again to react to other members' output is NOT
  duplication — it advances the conversation. Only skip if the task and input
  are genuinely identical to what was already done.`;
}

/**
 * When/When not guidance for escalate_to_* tools.
 *
 * @param agentName - Display name of the escalation target. Defaults to "the target agent".
 */
export function ESCALATE_PATTERNS(agentName = "the target agent"): string {
  return `${SCOPE_CHECK(agentName)}

When:

✅ You lack confidence or authority to make a decision — the risk of being wrong
  is higher than the cost of asking ${agentName}.

✅ The task requires knowledge, permissions, or context outside your scope and
  you cannot acquire them with the tools you have.

✅ You need explicit sign-off before proceeding — the action is irreversible or
  has high blast radius.

✅ You have hit a genuine deadlock: two valid options with opposing tradeoffs and
  no clear tie-breaker you can apply yourself.

When not:

❌ The scope check above failed — the blocker does not fall within ${agentName}'s
  authority or domain. Escalating to the wrong agent creates confusion.

❌ Your confidence is low only because you have not tried yet. Attempt the task
  first; escalate only if you get stuck.

❌ You are seeking reassurance rather than a decision. If ${agentName} would
  just confirm what you already know, do not escalate.`;
}

/**
 * When/When not guidance for review_with_* tools.
 *
 * @param agentName - Display name of the reviewer. Defaults to "the target agent".
 */
export function REVIEW_PATTERNS(agentName = "the target agent"): string {
  return `${SCOPE_CHECK(agentName)}

When:

✅ Your work is fully complete and ready for sign-off — not a draft, not
  partially done. ${agentName} reviews finished output, not work-in-progress.

✅ You lack the authority or domain expertise to approve the output yourself
  and upstream acceptance depends on ${agentName}'s verdict.

✅ The output has high stakes (public-facing change, irreversible action, cross-
  team impact) and an independent review reduces risk before it goes upstream.

✅ You feel confident but are not certain — keep self-confidence conservative
  and default to seeking review rather than self-approving. Proactive review
  is cheaper than a mistake that reaches upstream.

When not:

❌ Your work is still in progress. Finish and self-verify first.

❌ The scope check above failed — the output domain does not match ${agentName}'s
  specialisation. Find the right reviewer rather than skipping review altogether.`;
}
