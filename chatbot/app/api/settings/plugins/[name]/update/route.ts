/**
 * POST /api/settings/plugins/[name]/update?action=sync  — re-sync agent settings without git pull
 * POST /api/settings/plugins/[name]/update               — git pull + re-sync agent settings
 */

import { updatePlugin, syncPlugin } from "@@/lib/plugin-manager";

export async function POST(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  try {
    const plugin = action === "sync" ? await syncPlugin(name) : await updatePlugin(name);
    return Response.json({ plugin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not installed") ? 404 : 422;
    return Response.json({ error: message }, { status });
  }
}
