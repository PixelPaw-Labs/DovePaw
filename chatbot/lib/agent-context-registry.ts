/**
 * Tracks the A2A contextId per agent per Dove session.
 * Allows ask_* tools to auto-resume agent sessions across multiple user turns.
 *
 * Parallel to SessionManager — owns the session-keyed map and its lifecycle.
 * Persists to DB (dove_agent_contexts) so context survives server restarts.
 */
import {
  setOrchestratorAgentContext,
  getOrchestratorAgentContexts,
  deleteOrchestratorAgentContexts,
} from "@/lib/db";

export class AgentContextRegistry {
  private readonly sessions = new Map<string, Map<string, string>>();

  /**
   * Return the context map for a known session, loading from DB if not in cache.
   * Always returns a map — empty if this session has never called ask_*.
   */
  getOrLoad(sessionId: string): Map<string, string> {
    const cached = this.sessions.get(sessionId);
    if (cached) return cached;
    const fromDb = getOrchestratorAgentContexts(sessionId);
    this.sessions.set(sessionId, fromDb);
    return fromDb;
  }

  /**
   * Flush all current entries to DB and register the map under sessionId.
   * Called at the end of every turn once resolvedSessionId is known —
   * including the first turn when sessionId was null during tool execution.
   */
  persist(sessionId: string, ctxMap: Map<string, string>): void {
    this.sessions.set(sessionId, ctxMap);
    for (const [manifestKey, contextId] of ctxMap) {
      setOrchestratorAgentContext(sessionId, manifestKey, contextId);
    }
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
    deleteOrchestratorAgentContexts(sessionId);
  }
}
