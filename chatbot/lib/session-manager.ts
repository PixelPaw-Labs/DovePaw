import type { AgentWorkspace } from "@/a2a/lib/workspace";

export interface SessionState {
  claudeSessionId: string;
  workspace: AgentWorkspace;
  startedAt: Date;
  label: string;
}

export interface SessionInfo {
  contextId: string;
  startedAt: Date;
  label: string;
}

const MAX_SESSIONS = 5;

export class SessionManager {
  private readonly sessions = new Map<string, SessionState>();

  get(contextId: string): SessionState | undefined {
    return this.sessions.get(contextId);
  }

  set(contextId: string, state: SessionState): void {
    this.sessions.set(contextId, state);
    this.evictOldestIfNeeded();
  }

  delete(contextId: string): void {
    const state = this.sessions.get(contextId);
    if (state) {
      state.workspace.cleanup();
      this.sessions.delete(contextId);
    }
  }

  getSessions(): SessionInfo[] {
    return [...this.sessions.entries()]
      .map(([contextId, s]) => ({ contextId, startedAt: s.startedAt, label: s.label }))
      .toReversed();
  }

  private evictOldestIfNeeded(): void {
    if (this.sessions.size <= MAX_SESSIONS) return;
    for (const [oldestId, oldestState] of this.sessions) {
      oldestState.workspace.cleanup();
      this.sessions.delete(oldestId);
      break;
    }
  }
}
