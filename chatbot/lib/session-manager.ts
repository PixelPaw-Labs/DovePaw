import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setActiveSession, upsertSession, getSessionResumable } from "@/lib/db";
import type { StreamedResult } from "@/lib/a2a-client";
import type { SessionMessage } from "@/lib/message-types";
import { restoreAgentWorkspace } from "@/a2a/lib/workspace";
import type { AgentWorkspace } from "@/a2a/lib/workspace";

export interface SessionPersistence {
  save(contextId: string, result: StreamedResult, processContent?: string): void;
}

export interface SessionState {
  subagentSessionId: string;
  workspace: AgentWorkspace;
  startedAt: Date;
  label: string;
}

export interface SessionSaveOptions {
  label?: string;
  userText?: string;
  userMsgId?: string;
  assistantMsg?: SessionMessage;
  subagentSessionId?: string;
  workspacePath?: string;
}

export interface SessionInfo {
  id: string;
  startedAt: Date;
  label: string;
}

export const MAX_SESSIONS = 20;

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
      .map(([contextId, s]) => ({ id: contextId, startedAt: s.startedAt, label: s.label }))
      .toReversed();
  }

  /**
   * Restore a session from the DB into this in-memory manager.
   * No-op if the session is already loaded, unknown, or its workspace no longer exists.
   */
  restore(contextId: string, agentId: string): void {
    if (this.sessions.has(contextId)) return;
    const resumable = getSessionResumable(contextId, agentId);
    if (!resumable || !existsSync(resumable.workspacePath)) return;
    this.set(contextId, {
      subagentSessionId: resumable.subagentSessionId,
      workspace: restoreAgentWorkspace(resumable.workspacePath),
      startedAt: new Date(resumable.startedAt),
      label: resumable.label,
    });
  }

  static save(
    agentId: string,
    contextId: string,
    result: StreamedResult,
    options: SessionSaveOptions = {},
  ): void {
    const {
      label = "Session",
      userText = "",
      userMsgId,
      assistantMsg,
      subagentSessionId,
      workspacePath,
    } = options;
    const userMsg: SessionMessage = {
      id: userMsgId ?? randomUUID(),
      role: "user",
      segments: [{ type: "text", content: userText }],
    };
    const assistantResolved: SessionMessage | null =
      assistantMsg ??
      (result.output
        ? {
            id: randomUUID(),
            role: "assistant",
            segments: [{ type: "text", content: result.output }],
          }
        : null);
    setActiveSession(agentId, contextId);
    upsertSession({
      id: contextId,
      agentId,
      startedAt: new Date().toISOString(),
      label,
      messages: assistantResolved ? [userMsg, assistantResolved] : [userMsg],
      progress: result.progress,
      subagentSessionId,
      workspacePath,
    });
  }

  static makePersistence(agentId: string): SessionPersistence {
    return {
      save(contextId, result, processContent) {
        const msg: SessionMessage = {
          id: randomUUID(),
          role: "assistant",
          segments: [{ type: "text", content: result.output }],
          ...(processContent ? { processContent } : {}),
        };
        SessionManager.save(agentId, contextId, result, { assistantMsg: msg });
      },
    };
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
