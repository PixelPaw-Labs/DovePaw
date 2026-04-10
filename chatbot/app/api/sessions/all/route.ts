import { deleteAllSessions } from "@/lib/db";
import { sessionRunner } from "@/lib/session-runner";
import { agentContextRegistry } from "@/lib/agent-context-registry";
import { deletedSessionIds } from "@/lib/deleted-session-ids";

export async function DELETE() {
  // Mark every running session as deleted so their finally-blocks skip re-saving rows.
  for (const id of sessionRunner.getRunningSessionIds()) {
    deletedSessionIds.add(id);
  }
  // Abort all subprocesses (triggers their finally-blocks which call clearSessionBuffer).
  sessionRunner.abortAll();
  // Clear the in-memory agent-context cache (DB rows are wiped by deleteAllSessions).
  agentContextRegistry.clearAll();
  deleteAllSessions();
  return Response.json({ ok: true });
}
