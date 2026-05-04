/** Built-in UserPromptSubmit reminders injected on every sub-agent turn. */

export const SUBAGENT_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), tell the user what you've kicked off, then WAIT as a **background Task** concurrently.
</reminder>`;

export const GROUP_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), then WAIT as a **background Task** concurrently.
- Do NOT output and respond with any text such as narration, status updates, or confirmations.
</reminder>`;

function buildMemoryBullet(memoryDir: string, startToolName?: string): string {
  return (
    `<reminder>\n` +
    `- It is the workflow you MUST follow:` +
    ` When the user's intent is resolved by **ASKING A QUESTION NOT ABOUT THIS AGENT**` +
    ` that this agent can answer, you MUST read \`${memoryDir}/memory/MEMORY.md\` first — NEVER skip this step.` +
    ` If memory is sufficient, reply directly.` +
    ` If memory is NOT sufficient → you MUST reply: "Please call \`${startToolName ?? "the start tool"}\` to fulfil this request."` +
    ` Do NOT attempt to answer from general knowledge.\n` +
    `</reminder>`
  );
}

/** Appends the start-mode reminder to the instruction, forcing the agent to call the start tool. */
export const withStartReminder = (instruction: string, manifestKey: string): string =>
  `${instruction}\n<reminder>Must call "start_${manifestKey}" tool</reminder>`;

/** Appends the ask-mode memory workflow reminder to the instruction. No-op when memoryDir is absent. */
export const withMemoryReminder = (
  instruction: string,
  memoryDir?: string,
  startToolName?: string,
): string =>
  memoryDir ? `${instruction}\n${buildMemoryBullet(memoryDir, startToolName)}` : instruction;

/** Returns the sub-agent reminder with optional extra instructions injected inside the <reminder> tag. */
export function buildSubAgentReminder(extra?: string): string {
  const parts = extra?.trim();
  if (!parts) return SUBAGENT_PROMPT_REMINDER;
  return SUBAGENT_PROMPT_REMINDER.replace("</reminder>", `\n${parts}\n</reminder>`);
}

/** Returns the group reminder with optional extra instructions injected inside the <reminder> tag. */
export function buildGroupReminder(extra?: string): string {
  if (!extra?.trim()) return GROUP_PROMPT_REMINDER;
  return GROUP_PROMPT_REMINDER.replace("</reminder>", `\n${extra.trim()}\n</reminder>`);
}
