/**
 * Shared OpenViking sidecar boot logic — used by both Electron (main process)
 * and the standalone boot script (scripts/boot-openviking.ts).
 *
 * Deliberately has no Next.js dependency so it can be compiled by tsup for
 * Electron and run directly via tsx for the dev boot script.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { consola } from "consola";
import { z } from "zod";
import { OPENVIKING_CONFIG_DIR, OPENVIKING_DATA_DIR, OPENVIKING_SERVER_CONFIG } from "./paths";
import { httpHealthProbe } from "./http-health-probe";

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 500;

const ovServerConfigSchema = z.looseObject({
  server: z.looseObject({
    auth_mode: z.string().optional(),
    host: z.string().optional(),
    root_api_key: z.string().optional(),
  }),
  storage: z.object({ workspace: z.string().optional() }).optional(),
});

const preflightSchema = z.object({
  embedding: z.object({ dense: z.object({ provider: z.string().min(1) }) }).optional(),
  vlm: z.object({ provider: z.string().min(1) }).optional(),
});

/**
 * The server block written into every DovePaw-scoped `ov.conf`. Single
 * source of truth — ensureSidecarConfig() and the API route's save handler
 * both use this so they cannot drift.
 */
export const DEV_MODE_SERVER_BLOCK = {
  auth_mode: "dev" as const,
  host: "127.0.0.1" as const,
};

export async function ensureSidecarConfig(): Promise<void> {
  await mkdir(OPENVIKING_CONFIG_DIR, { recursive: true });
  await mkdir(OPENVIKING_DATA_DIR, { recursive: true });
  if (existsSync(OPENVIKING_SERVER_CONFIG)) {
    try {
      ovServerConfigSchema.parse(JSON.parse(await readFile(OPENVIKING_SERVER_CONFIG, "utf-8")));
      return;
    } catch {
      // fall through and regenerate
    }
  }
  const config = {
    server: DEV_MODE_SERVER_BLOCK,
    storage: { workspace: OPENVIKING_DATA_DIR },
  };
  await writeFile(OPENVIKING_SERVER_CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Reject before spawning when ov.conf is missing fields whose absence is
 * known to crash boot. Keeps the modal/fallback flow snappy.
 */
export async function preflightConfig(): Promise<void> {
  const parsed = preflightSchema.parse(
    JSON.parse(await readFile(OPENVIKING_SERVER_CONFIG, "utf-8")),
  );
  const missing: string[] = [];
  if (!parsed.embedding?.dense.provider) missing.push("embedding.dense.provider");
  if (!parsed.vlm?.provider) missing.push("vlm.provider");
  if (missing.length === 0) return;
  throw new Error(
    `OpenViking ov.conf is missing required fields (${missing.join(", ")}). ` +
      "Configure them in Settings → OpenViking before the sidecar can start.",
  );
}

/**
 * Boot the OpenViking sidecar. Returns the child process handle.
 *
 * @param port     Port to bind to (caller must pick a free port).
 * @param detached When true the child is detached + unref'd so it survives
 *                 the parent process exiting (used by the boot script).
 *                 When false (default) the child is owned by the parent
 *                 (used by Electron main).
 */
export async function bootOpenViking(
  port: number,
  { detached = false }: { detached?: boolean } = {},
): Promise<ChildProcess> {
  await ensureSidecarConfig();
  await preflightConfig();

  const proc = spawn(
    "openviking-server",
    ["--config", OPENVIKING_SERVER_CONFIG, "--port", String(port)],
    {
      stdio: detached ? "ignore" : ["ignore", "inherit", "inherit"],
      env: process.env,
      detached,
    },
  );
  if (detached) proc.unref();
  proc.on("error", (err) => {
    consola.error("openviking-server failed to spawn:", err.message);
  });

  try {
    await httpHealthProbe(`http://localhost:${port}/health`, {
      timeoutMs: HEALTH_TIMEOUT_MS,
      intervalMs: HEALTH_POLL_INTERVAL_MS,
    });
  } catch (err) {
    try {
      proc.kill("SIGTERM");
    } catch {}
    throw err;
  }

  return proc;
}
