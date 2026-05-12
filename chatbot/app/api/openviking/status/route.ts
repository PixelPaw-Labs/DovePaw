/**
 * GET /api/openviking/status — lightweight liveness probe for the chat header
 * status button. Returns whether the sidecar port file exists and whether
 * the user has launched the console process. Polled every few seconds.
 */

import { access } from "node:fs/promises";
import { OPENVIKING_PORT_FILE } from "@@/lib/paths";
import { getConsoleUrl } from "@/lib/openviking/console";

export async function GET(): Promise<Response> {
  const sidecarRunning = await fileExists(OPENVIKING_PORT_FILE);
  const consoleUrl = getConsoleUrl();
  return Response.json({ sidecarRunning, consoleUrl: consoleUrl ?? undefined });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
