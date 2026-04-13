/**
 * Per-execution registry that tracks pending await operations for a subagent session.
 *
 * Each entry pairs an operation ID with the exact await tool that must be called
 * to resolve it, so the Stop hook can emit unambiguous per-tool instructions
 * instead of a flat list of IDs.
 *
 * One PendingRegistry instance is created per QueryAgentExecutor.execute() call,
 * eliminating the cross-session false-blocking that occurred when spawn.ts used
 * a module-level map shared across all concurrent executions.
 */

export interface PendingEntry {
  /** MCP tool name (without mcp__agents__ prefix) to call to resolve this operation. */
  awaitTool: string;
  /** Parameter key the await tool expects (e.g. "runId" or "taskId"). */
  idKey: string;
  /** The operation ID value. */
  id: string;
}

export class PendingRegistry {
  private readonly entries = new Map<string, PendingEntry>();

  register(entry: PendingEntry): void {
    this.entries.set(entry.id, entry);
  }

  resolve(id: string): void {
    this.entries.delete(id);
  }

  hasPending(): boolean {
    return this.entries.size > 0;
  }

  getPending(): PendingEntry[] {
    return [...this.entries.values()];
  }
}
