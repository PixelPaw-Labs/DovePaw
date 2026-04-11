/**
 * GET  /api/settings/plugins   — List all installed plugins
 * POST /api/settings/plugins   — Register a plugin from a git URL or local path
 */

import { z } from "zod";
import { listPlugins, addPlugin } from "@@/lib/plugin-manager";
import { parseBody } from "@/lib/env-var-routes";

export async function GET() {
  const plugins = await listPlugins();
  return Response.json({ plugins });
}

const postBodySchema = z.object({
  source: z.string().min(1, "source is required"),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  try {
    const plugin = await addPlugin(parsed.data.source);
    return Response.json({ plugin }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 422 });
  }
}
