/**
 * GET  /api/settings/agent-notifications?agentName=<name>
 *   Returns { notifications: AgentNotificationConfig | null }
 *
 * PUT  /api/settings/agent-notifications
 *   Body: { agentName: string; notifications: AgentNotificationConfig }
 *   Saves the per-agent notification config.
 *
 * DELETE  /api/settings/agent-notifications?agentName=<name>
 *   Removes the notification config entirely.
 */

import { z } from "zod";
import { readAgentSettings, writeAgentSettings } from "@@/lib/settings";
import { agentNotificationConfigSchema } from "@@/lib/settings-schemas";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentName = url.searchParams.get("agentName");
  if (!agentName) {
    return Response.json({ error: "Missing agentName query param" }, { status: 400 });
  }
  const settings = await readAgentSettings(agentName);
  return Response.json({ notifications: settings.notifications ?? null });
}

const putBodySchema = z.object({
  agentName: z.string().min(1),
  notifications: agentNotificationConfigSchema,
});

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { agentName, notifications } = parsed.data;
  const existing = await readAgentSettings(agentName);
  await writeAgentSettings(agentName, { ...existing, notifications });
  return Response.json({ notifications });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const agentName = url.searchParams.get("agentName");
  if (!agentName) {
    return Response.json({ error: "Missing agentName query param" }, { status: 400 });
  }
  const existing = await readAgentSettings(agentName);
  const { notifications: _removed, ...rest } = existing;
  await writeAgentSettings(agentName, rest);
  return Response.json({ notifications: null });
}
