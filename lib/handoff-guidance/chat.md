Before calling the target agent, answer these two questions:

1. **What is the scope of the current task?**
   Re-read the original instruction. Identify the domain: backend, frontend,
   infra, data, security, etc.
   <example>"fix the API response" is backend; "update the button label" is frontend.</example>

2. **Does the target agent's description match that scope?**
   Read their description word-for-word. If the current task's domain does not
   appear in their description, do not call — even if they are linked.

Only proceed if both answers align. A link means "these agents can cooperate";
it does not mean "always involve both". Irrelevant handoffs create noise,
wasted work, and confusion for the receiving agent.

When:

✅ You have finished your own work and produced concrete, actionable output — a
list of issues, a diff, a report, a set of IDs — that the target agent is built
to act on. The handoff has substance.

✅ The workflow explicitly continues into the target agent's domain. Recognise
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

✅ The target agent needs information you possess (findings, context, a prior
session contextId) that it cannot obtain itself without re-doing your work.

✅ The result matters to the current task — without the target agent's response,
your task is incomplete or its output is unverified.

When not:

❌ Your own work is not yet done. Always finish and verify your output first,
then hand off. Incomplete handoffs create cascading failures.

❌ You found nothing actionable — zero issues, empty results, no failures. If
there is nothing to hand off, do not call.

❌ The scope check above failed — the current task domain does not match
the target agent's specialisation. Being linked is not a reason to call.

❌ You are speculating or being cautious. "It might be useful to also ask
the target agent" is not a trigger. Concrete output is the trigger.

❌ The instruction you would send is vague: "please help", "check this", "take
a look". If you cannot write a specific, complete instruction, you are not
ready to hand off.

❌ Calling would duplicate **execution work** the target agent already completed
this session — e.g. the agent already fixed the bug, ran the migration, or
produced the same report. Do not re-run identical work.
Exception: in discussion, brainstorming, or collaborative prediction tasks,
calling the target agent again to react to other members' output is NOT
duplication — it advances the conversation. Only skip if the task and input
are genuinely identical to what was already done.
