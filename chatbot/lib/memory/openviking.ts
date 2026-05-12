/**
 * OpenViking memory provider.
 *
 * Boots a localhost-only OpenViking sidecar in `auth_mode: "dev"` and routes
 * every group's moments through a `viking://agent/<groupContextId>/moments`
 * namespace. In dev mode all requests resolve as `default/default` ROOT;
 * group isolation is enforced by the `--agent-id` flag the agent passes on
 * every `ov` call.
 *
 * Boot lifecycle (static `boot()`):
 *   ensureSidecarConfig → preflight → spawn openviking-server → waitForReady → writeCliConfig
 *
 * Per-group bootstrap (instance `initGroup()`):
 *   `ov mkdir viking://agent/<id>/moments`
 *
 * If anything in the boot path fails, callers fall back to MarkdownMemoryProvider
 * (see `getMemoryProvider()` registry).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { consola } from "consola";
import { z } from "zod";
import {
  OPENVIKING_CONFIG_DIR,
  OPENVIKING_SERVER_CONFIG,
  OPENVIKING_CLI_CONFIG,
  OPENVIKING_DATA_DIR,
} from "@@/lib/paths";
import type { MemoryProvider } from "./types";
import { indentedMomentsPattern, rosterBullet } from "./types";
import { terminateChild } from "@/lib/process-orphan-cleanup";
import { httpHealthProbe } from "@/lib/http-health-probe";

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

/**
 * The server block written into every DovePaw-scoped `ov.conf`. Single
 * source of truth — `ensureSidecarConfig()` and the API route's save
 * handler both use this so they cannot drift.
 *
 * `dev` mode means: localhost-bound, no API key, all requests resolve as
 * default/default ROOT. Group isolation comes from `--agent-id` on every
 * `ov` call, not the auth identity.
 */
export const DEV_MODE_SERVER_BLOCK = {
  auth_mode: "dev" as const,
  host: "127.0.0.1" as const,
};

export class OpenVikingMemoryProvider implements MemoryProvider {
  /** Port the sidecar process is reachable on. */
  readonly port: number;
  /** Child process handle so callers can SIGTERM on shutdown. */
  readonly proc: ChildProcess | null;

  constructor(port: number, proc: ChildProcess | null = null) {
    this.port = port;
    this.proc = proc;
  }

  /**
   * Boot the OpenViking sidecar in localhost-only dev mode and return a
   * fully-provisioned provider. Rejects on spawn or health-probe failure.
   *
   * dev mode means: no `root_api_key`, all requests accepted as
   * default/default ROOT. Safe because the sidecar binds to 127.0.0.1 only.
   * Group-scope isolation still works via the `--agent-id` flag passed by
   * every `ov` invocation.
   */
  static async boot(port: number): Promise<OpenVikingMemoryProvider> {
    await ensureSidecarConfig();
    await preflightConfig();
    const proc = spawnSidecar(port);
    try {
      await waitForReady(port);
      await writeCliConfig(port);
    } catch (err) {
      try {
        proc.kill("SIGTERM");
      } catch {}
      throw err;
    }
    return new OpenVikingMemoryProvider(port, proc);
  }

  shutdown(): void {
    if (!this.proc) return;
    terminateChild(this.proc);
  }

  async initGroup(groupContextId: string, _workspacePath: string): Promise<void> {
    await ensureNamespace(this.port, groupContextId);
  }

  async deleteGroup(groupContextId: string, _workspacePath: string): Promise<void> {
    await removeNamespace(this.port, groupContextId);
  }

  buildReminder(workspacePath: string, groupContextId: string): string {
    return `You are participating in a group task. Before starting:
${rosterBullet(workspacePath)}
- Query past moments before acting: run
  \`ov find <topic> --agent-id ${groupContextId}\` to see what members
  already decided or produced.
- Save moments with
  \`ov add-memory --agent-id ${groupContextId} "<content>"\`
  when: decision reached, artifact complete, insight worth sharing.
  Writing style:
${indentedMomentsPattern()}`;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Reject before spawning the sidecar when ov.conf is missing fields whose
 * absence is known to crash boot. Keeps the modal/fallback flow snappy: the
 * user sees "configure" instead of waiting 30s for a health-probe timeout.
 */
const preflightSchema = z.object({
  embedding: z.object({ dense: z.object({ provider: z.string().min(1) }) }).optional(),
  vlm: z.object({ provider: z.string().min(1) }).optional(),
});

async function preflightConfig(): Promise<void> {
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

async function ensureSidecarConfig(): Promise<void> {
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

function spawnSidecar(port: number): ChildProcess {
  const proc = spawn(
    "openviking-server",
    ["--config", OPENVIKING_SERVER_CONFIG, "--port", String(port)],
    { stdio: ["ignore", "inherit", "inherit"], env: process.env },
  );
  proc.on("error", (err) => {
    consola.error("openviking-server failed to spawn:", err.message);
  });
  return proc;
}

function waitForReady(port: number): Promise<void> {
  return httpHealthProbe(`http://localhost:${port}/health`, {
    timeoutMs: HEALTH_TIMEOUT_MS,
    intervalMs: HEALTH_POLL_INTERVAL_MS,
  });
}

/**
 * Write a minimal `ovcli.conf` for dev-mode auth. No api_key — the sidecar
 * binds to localhost and accepts every request as default/default ROOT.
 * The `ov` CLI still needs the URL and tenant defaults so its requests
 * land in the right account/user namespace.
 */
async function writeCliConfig(port: number): Promise<void> {
  const config = {
    url: `http://localhost:${port}`,
    account: "default",
    user: "default",
  };
  await writeFile(OPENVIKING_CLI_CONFIG, JSON.stringify(config, null, 2), { mode: 0o600 });
  await chmod(OPENVIKING_CLI_CONFIG, 0o600);
}

async function ensureNamespace(port: number, groupContextId: string): Promise<void> {
  const { exitCode, stderr } = await runOv(port, [
    "mkdir",
    "--parents",
    "--agent-id",
    groupContextId,
    `viking://agent/${groupContextId}/moments`,
  ]);
  if (exitCode !== 0 && !/already exists/i.test(stderr)) {
    throw new Error(
      `ov mkdir viking://agent/${groupContextId}/moments failed (exit ${exitCode}): ${stderr}`,
    );
  }
}

/**
 * Best-effort cleanup of a group's agent namespace. Swallows all failures —
 * if the sidecar is down, the binary is missing, or the namespace was never
 * created, the function still resolves so the caller's session-delete path
 * is never blocked.
 */
async function removeNamespace(port: number, groupContextId: string): Promise<void> {
  try {
    await runOv(port, [
      "rm",
      "--recursive",
      "--agent-id",
      groupContextId,
      `viking://agent/${groupContextId}`,
    ]);
  } catch {
    // sidecar unreachable or binary missing — drop silently
  }
}

/** Shell out to the ov CLI with the dovepaw cli config, return exit + stderr. */
function runOv(port: number, args: string[]): Promise<{ exitCode: number; stderr: string }> {
  const child = spawn("ov", args, {
    env: {
      ...process.env,
      OPENVIKING_CLI_CONFIG_FILE: OPENVIKING_CLI_CONFIG,
      OV_SERVER_URL: `http://localhost:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  return new Promise((resolve, reject) => {
    child.on("close", (code) => resolve({ exitCode: code ?? 0, stderr }));
    child.on("error", reject);
  });
}
