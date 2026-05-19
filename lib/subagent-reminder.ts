/** Built-in UserPromptSubmit reminders injected on every sub-agent turn. */

export const SUBAGENT_PROMPT_REMINDER = `<reminder>
- **Bad:** Do the work inline when asked to perform a task. **Correct:** ALWAYS call \`start_*\` first (returns runId immediately), tell the user what you've kicked off, then WAIT via \`await_*\` concurrently.
{{extra}}
</reminder>`;

export const GROUP_PROMPT_REMINDER = `<reminder>
- **Bad:** Do the work inline when asked to perform a task. **Correct:** ALWAYS call \`start_*\` first (returns runId immediately), then WAIT via \`await_*\` concurrently.
- **Bad:** Output narration, status updates, or confirmations. **Correct:** Do not output narration, status updates, or confirmations.
{{extra}}
</reminder>`;

function buildMemoryBullet(memoryDir: string, startToolName?: string): string {
  const escalate = startToolName ?? "the start tool";
  return (
    `<reminder>\n` +
    `- **Bad:** Answer a question without reading memory first. **Correct:** NEVER skip the memory read — ALWAYS read \`${memoryDir}/memory/MEMORY.md\` and, if a relevant entry exists, read that file before answering.\n` +
    `- **Bad:** Answer when memory is missing, incomplete, or doesn't fully cover the question. **Correct:** Your ENTIRE response MUST be this exact sentence — no other words: "Memory insufficient — you MUST call \`${escalate}\` to answer this question." - no exceptions, no reasoning about whether to skip.\n` +
    `- **Bad:** Add or infer details beyond what memory says. **Correct:** Reply using only what memory contains.\n` +
    `</reminder>`
  );
}

/** Appends the start-mode reminder to the instruction, forcing the agent to call the start tool. */
export const withStartReminder = (instruction: string, manifestKey: string): string =>
  `${instruction}\n<reminder>Must call "start_${manifestKey}" tool</reminder>`;

/**
 * Removes any `<reminder>Must call "start_*" tool</reminder>` tags from the instruction.
 *
 * The start-tool reminder is aimed at the sub-agent LLM, not the underlying script.
 * Sub-agents sometimes copy their incoming instruction (reminder included) into the
 * `start_*` tool call, so we strip it defensively before handing the instruction to
 * the spawned process.
 */
export const stripStartReminder = (instruction: string): string =>
  instruction.replace(/\n*<reminder>Must call "start_[^"]*" tool<\/reminder>\n*/g, "");

/** Appends the ask-mode memory workflow reminder to the instruction. No-op when memoryDir is absent. */
export const withMemoryReminder = (
  instruction: string,
  memoryDir?: string,
  startToolName?: string,
): string =>
  memoryDir ? `${instruction}\n${buildMemoryBullet(memoryDir, startToolName)}` : instruction;

/** Returns the sub-agent reminder with optional extra instructions injected inside the <reminder> tag. */
export function buildSubAgentReminder(extra?: string): string {
  return SUBAGENT_PROMPT_REMINDER.replace("{{extra}}", extra?.trim() ? extra.trim() : "");
}

/** Returns the group reminder with optional extra instructions injected inside the <reminder> tag. */
export function buildGroupReminder(extra?: string): string {
  return GROUP_PROMPT_REMINDER.replace("{{extra}}", extra?.trim() ? extra.trim() : "");
}
