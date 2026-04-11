/**
 * DELETE /api/settings/plugins/[name]  — Remove a plugin's agent settings from the registry
 */

import { removePlugin } from "@@/lib/plugin-manager";

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
