/**
 * Pluggable memory provider for group-chat moments.
 *
 * One concrete provider is active at a time, selected at A2A boot:
 *   - OpenVikingMemoryProvider — used when the OpenViking sidecar is healthy.
 *   - MarkdownMemoryProvider   — filesystem fallback (always available).
 *
 * The provider is responsible for two things:
 *   1. Materialising any per-group state needed before members start.
 *   2. Producing the <reminder> body that tells members how to read/write moments.
 */
export interface MemoryProvider {
  /**
   * Prepare per-group state. Called once from makeInitGroupTool.
   *
   * @param groupContextId The group's A2A context ID (also used as `agent_id`).
   * @param workspacePath  The shared group workspace directory on disk.
   */
  initGroup(groupContextId: string, workspacePath: string): Promise<void>;

  /**
   * Tear down per-group state when the chat session is deleted. Must be
   * idempotent — safe to call when the group never had any state, when
   * the underlying backend is unreachable, or when the namespace has
   * already been removed.
   *
   * @param groupContextId The group's A2A context ID (= the `agent_id`).
   * @param workspacePath  The shared group workspace directory on disk.
   */
  deleteGroup(groupContextId: string, workspacePath: string): Promise<void>;

  /**
   * Build the body of the <reminder> block injected before each member's turn.
   * Includes the roster bullet and read/query instructions only — save instructions
   * are delivered via the PostToolUse hook (see makeGroupMomentSaveHook).
   */
  buildReadReminder(workspacePath: string, groupContextId: string): string;

  /**
   * Build the save-moments prompt returned as `{ decision: "block", reason }` by the
   * PostToolUse hook (see makeGroupMomentSaveHook) when an await_script_* tool
   * completes with status "completed". Blocking ensures the agent must respond before continuing.
   */
  buildSaveReminder(groupContextId: string, workspacePath: string): string;

  /**
   * Optional graceful teardown. Implementations that own a child process
   * (e.g. OpenVikingMemoryProvider) implement this to SIGTERM and await
   * the child's exit so the data-directory file lock is released before any
   * caller spawns a replacement.
   */
  shutdown?(): Promise<void>;
}

// ─── Shared writing pattern ───────────────────────────────────────────────────

export const MOMENTS_PATTERN = `All substance stays. Only fluff dies.

Resource rules:
- One resource per item.
- Name clearly (e.g. "auth-decision", "api-schema").

Core rules:
- Drop articles: a, an, the.
- Drop filler: just, really, basically, actually, simply.
- Drop pleasantries, hedging, preamble.
- Fragments OK.
- Short synonyms: "big" not "extensive", "fix" not "implement a solution for".
- Exact technical terms. Quote errors exactly.

Preferred pattern: [thing] [action] [reason]. [next step].
Example:
  Bad: "I've decided that we should probably use Redis for caching because it might help with performance."
  Good: "Cache layer: Redis. Reason: sub-ms reads, existing infra. Next: wire into auth middleware."

Exception — write full sentences for:
- Security warnings.
- Irreversible action confirmations.
- Multi-step sequences where fragments cause misread.`;

/** Indent the writing-style pattern two spaces so it nests under a bullet. */
export function indentedMomentsPattern(): string {
  return MOMENTS_PATTERN.split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

/** Common roster bullet shared by every provider. */
export function rosterBullet(workspacePath: string): string {
  return `- You MUST read ${workspacePath}/members/roster.md before doing anything. Only collaborate with, assign work to, or communicate with the agents listed there — no one else. This is a hard requirement.`;
}
