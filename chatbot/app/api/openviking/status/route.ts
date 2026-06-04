/**
 * GET /api/openviking/status — lightweight liveness probe for the chat header
 * status button. Returns whether the sidecar is running and, if so, the URL of
 * its built-in Web Studio (`/studio`). Polled every few seconds.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { OPENVIKING_PORT_FILE } from "@@/lib/paths";

const portFileSchema = z.object({ port: z.number().int().positive() });

export async function GET(): Promise<Response> {
  try {
    const { port } = portFileSchema.parse(
      JSON.parse(await readFile(OPENVIKING_PORT_FILE, "utf-8")),
    );
    return Response.json({ sidecarRunning: true, studioUrl: `http://127.0.0.1:${port}/studio` });
  } catch {
    return Response.json({ sidecarRunning: false });
  }
}
