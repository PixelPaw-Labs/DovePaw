/**
 * POST /api/chat/permission
 *
 * Resolves a pending PermissionRequest from the Claude Agent SDK hook.
 * The browser sends this after the user approves or denies in the Confirmation UI.
 */

import { z } from "zod";
import { resolvePendingPermission } from "@/lib/pending-permissions";

const permissionResponseSchema = z.object({
  requestId: z.string(),
  allowed: z.boolean(),
});

export async function POST(request: Request) {
  const { requestId, allowed } = permissionResponseSchema.parse(await request.json());
  const resolved = resolvePendingPermission(requestId, allowed);
  if (!resolved) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
