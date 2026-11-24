/**
 * PATCH  /api/settings/plugins/[name]  — Update a plugin's skill symlink target directories
 * DELETE /api/settings/plugins/[name]  — Remove a plugin's agent settings from the registry
 */

import { z } from "zod";
import { removePlugin, updatePluginSkillTargets } from "@@/lib/plugin-manager";
import { parseBody } from "@/lib/env-var-routes";

const patchBodySchema = z.object({
  skillTargets: z.array(z.string().min(1)),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const plugin = await updatePluginSkillTargets(name, parsed.data.skillTargets);
    return Response.json({ plugin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not installed") ? 404 : 422;
    return Response.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    await removePlugin(name);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not installed") ? 404 : 422;
    return Response.json({ error: message }, { status });
  }
}
