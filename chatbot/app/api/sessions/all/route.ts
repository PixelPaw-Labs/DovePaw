import { deleteAllSessions, getAllSessionWorkspacePaths, getRunningSessions } from "@/lib/db";
import { sessionRunner } from "@/lib/session-runner";
import { agentContextRegistry } from "@/lib/agent-context-registry";
import { deletedSessionIds } from "@/lib/deleted-session-ids";
import { restoreAgentWorkspace } from "@/a2a/lib/workspace";
import { readAgentsConfig } from "@@/lib/agents-config";
import { createAgentClient, resolveAgentPort } from "@/lib/a2a-client";

export async function DELETE() {
  // Mark every running session as deleted so their finally-blocks skip re-saving rows.
  for (const id of sessionRunner.getRunningSessionIds()) {
    deletedSessionIds.add(id);
  }
  // Abort all subprocesses (triggers their finally-blocks which call clearSessionBuffer).
  // sessionRunner only knows about chat-POST-initiated sessions; launchd-triggered
  // scheduled runs live on the A2A server and need a separate cancelTask call.
  sessionRunner.abortAll();

  // Cancel every running A2A task — covers both chat-POST sessions (idempotent
  // with sessionRunner.abortAll) and launchd-triggered scheduled sessions
  // (sessionRunner doesn't track them at all).
  const running = getRunningSessions();
  if (running.length > 0) {
    const agents = await readAgentsConfig();
    const agentByName = new Map(agents.map((a) => [a.name, a]));
    await Promise.all(
      running.map(async ({ id, agentId }) => {
        const agent = agentByName.get(agentId);
        if (!agent) return;
        const port = resolveAgentPort(agent.manifestKey);
        if (port === null) return;
        try {
          const client = await createAgentClient(port);
          await client.cancelTask({ id });
        } catch {
          /* server unreachable or task already done — best-effort */
        }
      }),
    );
  }

  // Clear the in-memory agent-context cache (DB rows are wiped by deleteAllSessions).
  agentContextRegistry.clearAll();
  // Collect workspace paths before wiping DB rows, then clean up the directories.
  const workspacePaths = getAllSessionWorkspacePaths();
  deleteAllSessions();
  await Promise.all(workspacePaths.map((path) => restoreAgentWorkspace(path).cleanup()));
  return Response.json({ ok: true });
}
