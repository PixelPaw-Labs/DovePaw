/**
 * GET  /api/openviking/config  — Read the dovepaw-scoped OpenViking config.
 *                                When missing, prefill from ~/.openviking/ov.conf
 *                                (user-global) for first-time setup. Never echo
 *                                a user-global file as authoritative.
 *
 * POST /api/openviking/config  — Validate + write ~/.dovepaw/openviking/ov.conf
 *                                with the supplied embedding/storage/vlm fields.
 *                                The server block is replaced with the
 *                                localhost dev-mode defaults — no api_key,
 *                                no root key — because all requests on the
 *                                localhost-bound sidecar resolve as
 *                                default/default ROOT. Reboots the sidecar
 *                                in-process: shuts down the previous
 *                                provider (SIGTERM → SIGKILL after 1s) and
 *                                registers the freshly-spawned one.
 */

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { consola } from "consola";
import {
  OPENVIKING_SERVER_CONFIG,
  OPENVIKING_PORT_FILE,
  OPENVIKING_SIDECAR_PID_FILE,
} from "@@/lib/paths";
import { USER_GLOBAL_OV_CONF } from "@/lib/openviking/prefill";
import { getMemoryProvider, setMemoryProvider } from "@/lib/memory";
import { DEV_MODE_SERVER_BLOCK, OpenVikingMemoryProvider } from "@/lib/memory/openviking";
import { writePidFile } from "@/lib/process-orphan-cleanup";
import { getAvailablePort } from "@/lib/get-available-port";

const denseEmbeddingSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  api_key: z.string().optional(),
  api_base: z.string().optional(),
  dimension: z.number().int().positive().optional(),
});

// We accept whatever the UI sends but ignore the `server` block — dev mode
// is the only mode this route writes.
const fullConfigSchema = z.looseObject({
  embedding: z.object({ dense: denseEmbeddingSchema }),
  storage: z.object({ workspace: z.string().optional() }).optional(),
  vlm: z.record(z.string(), z.unknown()).optional(),
});

const postBodySchema = z.object({ config: fullConfigSchema });

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const sidecarRunning = await fileExists(OPENVIKING_PORT_FILE);
  const dovepaw = await readJson(OPENVIKING_SERVER_CONFIG);
  if (dovepaw) {
    return Response.json({ config: dovepaw, source: "dovepaw", sidecarRunning });
  }
  const userGlobal = await readJson(USER_GLOBAL_OV_CONF);
  if (userGlobal) {
    return Response.json({
      config: userGlobal,
      source: "user-global-prefill",
      sidecarRunning,
    });
  }
  return Response.json({ config: null, source: "empty", sidecarRunning });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // Always write dev-mode server block — drops any stale root_api_key
  // / auth_mode the UI happens to round-trip. The localhost sidecar accepts
  // every request as default/default ROOT in this mode.
  const merged = {
    ...parsed.data.config,
    server: DEV_MODE_SERVER_BLOCK,
  };

  await mkdir(dirname(OPENVIKING_SERVER_CONFIG), { recursive: true });
  await writeFile(OPENVIKING_SERVER_CONFIG, JSON.stringify(merged, null, 2), { mode: 0o600 });

  // Shut down the previous sidecar (provider.shutdown handles SIGTERM +
  // SIGKILL backstop internally) so we don't orphan it on the host before
  // booting the fresh one. Best-effort.
  const previous = await getMemoryProvider();
  if (previous instanceof OpenVikingMemoryProvider) {
    try {
      previous.shutdown();
    } catch {}
    setMemoryProvider(null);
  }

  try {
    const port = await getAvailablePort();
    const provider = await OpenVikingMemoryProvider.boot(port);
    setMemoryProvider(provider);
    if (provider.proc?.pid) writePidFile(OPENVIKING_SIDECAR_PID_FILE, provider.proc.pid);
    await mkdir(dirname(OPENVIKING_PORT_FILE), { recursive: true });
    await writeFile(OPENVIKING_PORT_FILE, JSON.stringify({ port }, null, 2));
    return Response.json({ ok: true, status: "running", port });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    consola.warn(`OpenViking reboot after config save failed: ${msg}`);
    return Response.json({ ok: true, status: "config-saved-sidecar-down", error: msg });
  }
}
