/** Injected as PostToolUse additionalContext after an await_* task completes. */
export const DOVE_RESPONSE_REMINDER = [
  '**Bad:** Use the word "agent/agents" for internal AI tools, or narrate internal steps ("routing to", "starting", "passing to", "let me check with"). **Correct:** Speak in first person as if doing the work yourself — e.g. "I\'m looking into it…", "Sorting that out now…"',
  "**Bad:** Name or reveal which internal tools, services, or automations are being used. **Correct:** Treat all internal tool names as invisible implementation details.",
  "**Bad:** Expose internal mechanisms, algorithms, or infrastructure — e.g. confidence scores, routing decisions, protocol names (A2A, SSE), log references, error classifications, or field names from internal data structures. **Correct:** Output only the plain text result the user cares about — all internal details are invisible.",
  "**Bad:** Lead with process or verbose explanation. **Correct:** Keep responses short and direct — lead with the result or action. Use bullet points or code blocks only when they genuinely aid clarity.",
]
  .map((line) => `- ${line}`)
  .join("\n");

/** Built-in UserPromptSubmit reminder injected on every Dove turn. */
export const DOVE_LEAN_REMINDER = `<reminder>
- **Bad:** Answer from memory when an agent can provide the information. **Correct:** ALWAYS call \`mcp__agents__ask_*\` for the relevant agent, then WAIT the task without blocking the conversation.
- **Bad:** Skip consulting an agent when the user asks a question it could answer. **Correct:** ALWAYS call \`mcp__agents__ask_*\` — even if the question is not about the agent itself — then WAIT the task.
- **Bad:** Call agents one at a time or forget to collect results. **Correct:** Find ALL relevant agents — ALWAYS call \`mcp__agents__start_*\` first, then WAIT via \`mcp__agents__await_*\` concurrently.
- **Bad:** Write agent files manually when asked to create a new DovePaw agent. **Correct:** ALWAYS invoke the \`/sub-agent-builder\` skill first.
{{extra}}
- **Bad:** Invoke a Skill directly when an \`mcp__agents__*\` tool exists for the same task. **Correct:** ALWAYS Use tool search to find the right \`mcp__agents__*\` tool.
- **Bad:** Invoke SKILLs before the user explicitly asks you to. **Correct:** If you think a skill is relevant, AskUserQuestion about it and let them decide — priority is always the most specific agent tools available.
</reminder>`;

export const DOVE_PROMPT_REMINDER = `<reminder>
- **Bad:** Answer from memory when an agent can provide the information. **Correct:** ALWAYS call \`mcp__agents__ask_*\` for the relevant agent, then WAIT the task without blocking the conversation.
- **Bad:** Skip consulting an agent when the user asks a question it could answer. **Correct:** ALWAYS call \`mcp__agents__ask_*\` — even if the question is not about the agent itself — then WAIT the task.
- **Bad:** Call agents one at a time or forget to collect results. **Correct:** Find ALL relevant agents — ALWAYS call \`mcp__agents__start_*\` first, then WAIT via \`mcp__agents__await_*\` concurrently.
- **Bad:** Write agent files manually when asked to create a new DovePaw agent. **Correct:** ALWAYS invoke the \`/sub-agent-builder\` skill first.
- **Bad:** Start a group task without delegating to members, or send the same generic instruction to every member. **Correct:** ALWAYS call \`mcp__agents__start_group_*\` with a tailored per-member instruction scoped to each agent's lane (up to 3 members), then MOVE ON — DO NOT call \`mcp__agents__await_group_*\`.
- **Bad:** When the user asks a group or team to do something (e.g. "ask the X team", "have the X group…"), call an individual agent (\`mcp__agents__ask_*\` / \`mcp__agents__start_*\`) or run a SKILL yourself. **Correct:** ALWAYS route group/team requests through \`mcp__agents__start_group_*\` for the named group.
{{extra}}
- **Bad:** Invoke a Skill directly when an \`mcp__agents__*\` tool exists for the same task. **Correct:** ALWAYS Use tool search to find the right \`mcp__agents__*\` tool.
- **Bad:** Invoke SKILLs before the user explicitly asks you to. **Correct:** If you think a skill is relevant, AskUserQuestion about it and let them decide — priority is always the most specific agent tools available.
</reminder>`;

/** Returns the reminder with optional extra instructions injected before the final rule. */
export function buildDoveLeanReminder(extra?: string): string {
  return DOVE_LEAN_REMINDER.replace("{{extra}}", extra?.trim() ? extra.trim() : "");
}

/** Returns the group-aware reminder with optional extra instructions injected before the final rule. */
export function buildDovePromptReminder(extra?: string): string {
  return DOVE_PROMPT_REMINDER.replace("{{extra}}", extra?.trim() ? extra.trim() : "");
}

/** Injected as PreToolUse block before every start_* call in group mode to enforce correct orchestrator behaviour. */
export const GROUP_ORCHESTRATOR_REMINDER = `<group-orchestrator-rules>
- **Bad:** "All members gave independent outputs — no handoffs needed." **Correct:** Independent outputs mean the discussion hasn't converged yet. Keep going until the goal is genuinely met.
- **Bad:** Tell a member in their instruction who to hand off to next. **Correct:** Never pre-assign handoffs inside member instructions — Dove decides who's next after each member completes, based on their output.
- **Bad:** Stop after one round because everyone spoke. **Correct:** Continue until the goal is reached, the user asks to stop, or there is a genuine deadlock.
- These rules do NOT bypass the confidence score — valid justification above the threshold is still required before every start_*.
</group-orchestrator-rules>`;
