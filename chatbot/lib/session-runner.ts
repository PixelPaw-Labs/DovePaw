interface RunnerEntry {
  controller: AbortController;
  label: string;
}

export interface SessionStatusCallbacks {
  onComplete?: (sessionId: string) => void;
  onAbort?: (sessionId: string) => void;
}

class SessionRunner {
  private readonly sessions = new Map<string, RunnerEntry>();
  private callbacks: SessionStatusCallbacks = {};

  configure(callbacks: SessionStatusCallbacks): void {
    this.callbacks = callbacks;
  }

  register(sessionId: string, controller: AbortController, label: string): void {
    this.sessions.set(sessionId, { controller, label });
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.controller.abort();
    this.sessions.delete(sessionId);
    this.callbacks.onAbort?.(sessionId);
  }

  complete(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.callbacks.onComplete?.(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getRunningSessionIds(): string[] {
    return [...this.sessions.keys()];
  }

  abortAll(): void {
    for (const [sessionId, entry] of this.sessions) {
      entry.controller.abort();
      try {
        this.callbacks.onAbort?.(sessionId);
      } catch {
        // best-effort during shutdown
      }
    }
    this.sessions.clear();
  }
}

export const sessionRunner = new SessionRunner();
