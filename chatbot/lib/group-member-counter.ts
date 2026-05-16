/**
 * Shared group-member completion counter.
 *
 * `makeStartGroupTool` (in group-tools.ts) increments `started` for each
 * dispatched member; `makeAwaitTool` (in query-tools.ts) increments
 * `completed` when a member's await resolves with status "completed".
 * When `completed >= started`, the last await fires the group "done" event
 * and deletes the entry.
 *
 * Lives in its own file to avoid a circular dependency — group-tools.ts
 * already imports from query-tools.ts, so query-tools.ts cannot import
 * back from group-tools.ts.
 */
export const groupMemberCounters = new Map<string, { started: number; completed: number }>();
