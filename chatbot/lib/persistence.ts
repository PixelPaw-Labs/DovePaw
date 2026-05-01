import { closeStaleSessions, setSessionStatus } from "@/lib/db";
import { sessionRunner } from "@/lib/session-runner";

/**
 * Wire session-runner status callbacks to the DB and close any sessions left
 * running from a previous process. Call once at server startup.
 */
export function enablePersistence(): void {
  closeStaleSessions();
  sessionRunner.configure({
    onComplete: (id) => setSessionStatus(id, "done"),
    onAbort: (id) => setSessionStatus(id, "cancelled"),
  });
}
