/**
 * POST /api/internal/subagent-permission
 *
 * Called by QueryAgentExecutor (A2A process) when canUseTool fires during a
 * direct user chat session. Forwards the permission request to the browser as
 * a "permission" SSE event and long-polls until the user responds via the
 * existing POST /api/chat/permission endpoint.
 */

import { z } from "zod";
import { publishSessionEvent } from "@/lib/session-events";
import { addPendingPermission, resolvePendingPermission } from "@/lib/pending-permissions";

export const maxDuration = 86400;

const bodySchema = z.object({
  contextId: z.string(),
  requestId: z.string(),
  toolName: z.string(),
  toolInput: z.record(z.string(), z.unknown()),
  title: z.string().optional(),
});

export async function POST(request: Request) {
  const { contextId, requestId, toolName, toolInput, title } = bodySchema.parse(
    await request.json(),
  );

  publishSessionEvent(contextId, { type: "permission", requestId, toolName, toolInput, title });

  const abortPromise = new Promise<boolean>((resolve) => {
    request.signal.addEventListener("abort", () => resolve(false), { once: true });
  });

  const allowed = await Promise.race([addPendingPermission(requestId), abortPromise]);

  // If the A2A connection was dropped (session cancelled), clean up the pending entry.
  if (request.signal.aborted) {
    resolvePendingPermission(requestId, false);
  }

  return new Response(null, { status: allowed ? 200 : 403 });
}
