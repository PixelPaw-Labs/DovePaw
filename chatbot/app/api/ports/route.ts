/**
 * GET /api/ports — Returns the current port manifest from a2a/.ports.json.
 * Used by the AgentSidebar to display dynamic port assignments.
 */

import { readPortsManifest } from "@/a2a/lib/base-server";

export function GET() {
  const manifest = readPortsManifest();

  if (!manifest) {
    return Response.json({ error: "Servers not running — run: npm run servers" }, { status: 503 });
  }

  return Response.json(manifest);
}
