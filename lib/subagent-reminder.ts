/** Built-in UserPromptSubmit reminders injected on every sub-agent turn. */

export const SUBAGENT_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), tell the user what you've kicked off, then WAIT as a **background Task** concurrently.
</reminder>`;

export const GROUP_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), then WAIT as a **background Task** concurrently.
- Do NOT output and respond with any text such as narration, status updates, or confirmations.
</reminder>`;

function buildMemoryBullet(memoryDir: string, startToolName?: string): string {
  const escalate = startToolName ?? "the start tool";
  return (
    `<reminder>\n` +
    `- MEMORY WORKFLOW — MUST follow every time the user ASKS A QUESTION NOT ABOUT THIS AGENT:\n` +
    `  1. READ \`${memoryDir}/memory/MEMORY.md\` index — NEVER skip this step.\n` +
    `  2. SCAN the index for entries relevant to the user's question (topic, keyword, domain match).\n` +
    `     If a relevant entry is found → READ that memory file for full detail.\n` +
    `  3. EVALUATE sufficiency:\n` +
    `     - SUFFICIENT: memory directly and fully answers the question → reply using it. Do NOT add or invent details beyond what memory says.\n` +
    `     - NOT SUFFICIENT (including partial): reply ONLY: "Because the agent memory is insufficient to answer the question, you MUST call \`${escalate}\` to get the necessary information. It is NOT a recommended action but necessary." Do NOT guess, clarify, or partially answer.\n` +
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
