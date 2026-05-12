/**
 * POST /api/openviking/console — lazy console launcher.
 *
 * Spawns `python -m openviking.console.bootstrap` pointed at the live
 * OpenViking sidecar (port discovered from ~/.dovepaw/.openviking-port.json)
 * and returns the local URL. Idempotent — repeat calls return the same URL.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { OPENVIKING_PORT_FILE } from "@@/lib/paths";
import { launchConsole } from "@/lib/openviking/console";

const portFileSchema = z.object({ port: z.number().int().positive() });

export async function POST(): Promise<Response> {
  let sidecarPort: number;
  try {
    const parsed = portFileSchema.parse(JSON.parse(await readFile(OPENVIKING_PORT_FILE, "utf-8")));
    sidecarPort = parsed.port;
  } catch {
    return Response.json(
      { error: "OpenViking sidecar is not running. Configure it in Settings first." },
      { status: 409 },
    );
  }
  try {
    const url = await launchConsole(sidecarPort);
    return Response.json({ url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: msg }, { status: 500 });
  }
}
