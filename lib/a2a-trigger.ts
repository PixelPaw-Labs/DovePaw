/**
 * Trigger a DovePaw agent via the A2A server.
 *
 * Usage: a2a-trigger.mjs <manifestKey> <agentName> [jobId]
 *
 * Reads ~/.dovepaw/.ports.<port>.json to find the agent's port, sends a blocking
 * message via the A2A ClientFactory, and exits when the task reaches a
 * terminal state.
 *
 * When jobId is provided, reads the job's instruction from agent settings and
 * sends it as the A2A message. Self-cleans plist for onetime jobs after firing.
 *
 * @a2a-js/sdk is treated as external (not bundled) and deployed alongside
 * this script in ~/.claude/scheduler/node_modules/ — same pattern as
 * @ladybugdb/core.
 *
 * Exit codes:
 *   0 — task completed successfully
 *   1 — task failed, canceled, or server unavailable
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { consola } from "consola";
import { z } from "zod";
import { scheduledJobSchema, type ScheduledJob } from "./agents-config-schemas";
import { startAgentStream } from "./a2a-client";
import { agentDefinitionFile, portsFile } from "./paths";
import { jobPlistLabel } from "./plist-generate";

const agentFileSchema = z.object({ scheduledJobs: z.array(scheduledJobSchema).optional() });

const PORTS_FILE = portsFile(7473);

/**
 * Trigger an agent using sendMessageStream so the session is registered via the
 * same streaming code path as the chat route. This ensures the contextId can be
 * continued later from the session history UI.
 *
 * Pass `contextId` to continue an existing conversation; omit to start a fresh one.
 * The server-generated contextId for a fresh session becomes the DovePaw session ID.
 *
 * Returns the terminal task state: "completed" | "failed" | "canceled" | "unknown".
 */
export async function triggerAgent(
  port: number,
  instruction: string,
  contextId?: string,
): Promise<string> {
  const handle = await startAgentStream(port, instruction, undefined, contextId);
  if (!handle) return "unknown";

  let finalState = "unknown";
  for await (const event of handle.stream) {
    if (event.kind === "status-update" && event.final) {
      finalState = event.status.state;
    }
  }
  return finalState;
}

/** Returns the numeric port for `manifestKey` from a parsed ports manifest, or null if absent/wrong type. */
export function resolvePort(ports: Record<string, unknown>, manifestKey: string): number | null {
  const port = ports[manifestKey];
  return typeof port === "number" ? port : null;
}

/** Reads the job config for `jobId` from the agent's settings file. Returns null on any error or if not found. */
export function readJobConfig(agentName: string, jobId: string): ScheduledJob | null {
  try {
    const parsed = agentFileSchema.parse(
      JSON.parse(readFileSync(agentDefinitionFile(agentName), "utf-8")),
    );
    return parsed.scheduledJobs?.find((j) => j.id === jobId) ?? null;
  } catch (err) {
    consola.warn(
      `[a2a-trigger] Could not read agent settings for "${agentName}" — proceeding without instruction`,
      err,
    );
    return null;
  }
}

/** Bootout and unlink the plist for a completed onetime job. Errors are logged, not thrown. */
export function cleanupOnetimeJob(
  agentName: string,
  jobId: string,
  label: string | undefined,
  home: string,
  uid: number,
): void {
  const plistLabelStr = jobPlistLabel(agentName, jobId, label);
  const plistPath = `${home}/Library/LaunchAgents/${plistLabelStr}.plist`;
  try {
    execSync(`launchctl bootout gui/${uid} '${plistPath}'`, { stdio: "ignore" });
  } catch (err) {
    consola.warn(
      `[a2a-trigger] launchctl bootout failed for "${plistLabelStr}" — may already be unloaded`,
      err,
    );
  }
  try {
    if (existsSync(plistPath)) unlinkSync(plistPath);
  } catch (err) {
    consola.warn(`[a2a-trigger] Could not remove plist "${plistPath}"`, err);
  }
}

async function main(): Promise<void> {
  const manifestKey = process.argv[2];
  const agentName = process.argv[3];
  const jobId = process.argv[4];

  if (!manifestKey || !agentName) {
    consola.error("Usage: a2a-trigger.mjs <manifestKey> <agentName> [jobId]");
    process.exit(1);
  }

  let ports: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(readFileSync(PORTS_FILE, "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      consola.error("Invalid ports manifest format");
      process.exit(1);
    }
    ports = Object.fromEntries(Object.entries(raw));
  } catch {
    consola.error(`DovePaw A2A is not running — ${PORTS_FILE} not found`);
    process.exit(1);
  }

  const port = resolvePort(ports, manifestKey);
  if (port === null) {
    consola.error(`Agent "${manifestKey}" not found in ports manifest`);
    process.exit(1);
  }

  let instruction = "";
  let jobConfig: ScheduledJob | null = null;
  if (jobId) {
    jobConfig = readJobConfig(agentName, jobId);
    if (jobConfig) instruction = jobConfig.instruction;
  }

  consola.info(`[a2a-trigger] ${manifestKey} → port ${port}`);

  try {
    const state = await triggerAgent(port, instruction);
    consola.info(`[a2a-trigger] ${manifestKey} finished — state: ${state}`);

    if (jobId && jobConfig?.schedule?.type === "onetime") {
      cleanupOnetimeJob(
        agentName,
        jobId,
        jobConfig.label || undefined,
        process.env.HOME ?? "",
        process.getuid!(),
      );
    }

    process.exit(state === "completed" ? 0 : 1);
  } catch (err) {
    consola.error(`[a2a-trigger] Failed to reach A2A server on port ${port}:`, err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    consola.fatal("[a2a-trigger] Fatal:", err);
    process.exit(1);
  });
}
