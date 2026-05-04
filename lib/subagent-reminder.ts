/** Built-in UserPromptSubmit reminders injected on every sub-agent turn. */

export const SUBAGENT_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), tell the user what you've kicked off, then WAIT as a **background Task** concurrently.
</reminder>`;

export const GROUP_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), then WAIT as a **background Task** concurrently.
- Do NOT output and respond with any text such as narration, status updates, or confirmations.
</reminder>`;

/** Returns the sub-agent reminder with optional extra instructions injected inside the <reminder> tag. */
export function buildSubAgentReminder(
  extra?: string,
  memoryDir?: string,
  startToolName?: string,
  isAskMode?: boolean,
): string {
  if (isAskMode) {
    const memoryBullet = memoryDir
      ? `- When the user's intent is resolved by **ASKING A QUESTION NOT ABOUT THIS AGENT** that this agent can answer, you MUST read \`${memoryDir}/memory/MEMORY.md\` first — NEVER skip this step. If memory is sufficient, reply directly. If memory is NOT sufficient → you MUST reply: "Please call \`${startToolName ?? "the start tool"}\` to fulfil this request." Do NOT attempt to answer from general knowledge.`
      : undefined;
    const parts = [extra?.trim(), memoryBullet].filter(Boolean).join("\n");
    return parts ? `<reminder>\n${parts}\n</reminder>` : `<reminder>\n</reminder>`;
  }

  const parts = extra?.trim();
  if (!parts) return SUBAGENT_PROMPT_REMINDER;
  return SUBAGENT_PROMPT_REMINDER.replace("</reminder>", `\n${parts}\n</reminder>`);
}

/** Returns the group reminder with optional extra instructions injected inside the <reminder> tag. */
export function buildGroupReminder(extra?: string): string {
  if (!extra?.trim()) return GROUP_PROMPT_REMINDER;
  return GROUP_PROMPT_REMINDER.replace("</reminder>", `\n${extra.trim()}\n</reminder>`);
}
