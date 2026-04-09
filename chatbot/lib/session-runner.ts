import { setSessionStatus } from "@/lib/db";

interface RunnerEntry {
  controller: AbortController;
  label: string;
}

class SessionRunner {
  private readonly sessions = new Map<string, RunnerEntry>();

  register(sessionId: string, controller: AbortController, label: string): void {
    this.sessions.set(sessionId, { controller, label });
  }

  abort(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.controller.abort();
    this.sessions.delete(sessionId);
    setSessionStatus(sessionId, "cancelled");
  }

  complete(sessionId: string): void {
    this.sessions.delete(sessionId);
    setSessionStatus(sessionId, "done");
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
      // DB write may fail if SQLite is closing during process exit — ignore
      try {
        setSessionStatus(sessionId, "cancelled");
      } catch {
        // best-effort during shutdown
      }
    }
    this.sessions.clear();
  }
}

export const sessionRunner = new SessionRunner();
