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
 * sends it as the A2A message. Self-cleans scheduler config for onetime jobs after firing.
 *
 * @a2a-js/sdk is treated as external (not bundled) and deployed alongside
 * this script in ~/.claude/scheduler/node_modules/ — same pattern as
 * @ladybugdb/core.
 *
 * Exit codes:
 *   0 — task completed successfully
 *   1 — task failed or canceled
 *   2 — the agent never ran: no A2A server answering on the resolved port
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { consola } from "consola";
import { z } from "zod";
import { scheduledJobSchema, type ScheduledJob } from "./agents-config-schemas";
import { TaskState, taskStateToJSON } from "@a2a-js/sdk";
import { probeAgentCard, startAgentStream } from "./a2a-client";
import { agentDefinitionFile, portsFile } from "./paths";
import { scheduler } from "./scheduler";

const agentFileSchema = z.object({ scheduledJobs: z.array(scheduledJobSchema).optional() });

const PORTS_FILE = portsFile(Number(process.env.DOVEPAW_PORT ?? "7473"));

/**
 * A scheduled job can fire while DovePaw is still booting — after a reboot, or
 * when the Mac wakes from sleep and launchd immediately runs the missed job. A
 * bounded wait rides that out instead of losing the run; anything longer means
 * DovePaw simply is not running, which no amount of retrying will fix.
 */
const PROBE_ATTEMPTS = 6;
const PROBE_RETRY_MS = 20_000;

/**
 * Trigger an agent using sendMessageStream so the session is registered via the
 * same streaming code path as the chat route. This ensures the contextId can be
 * continued later from the session history UI.
 *
 * Pass `contextId` to continue an existing conversation; omit to start a fresh one.
 * The server-generated contextId for a fresh session becomes the DovePaw session ID.
 *
 * Returns the last TaskState seen on the stream, or TASK_STATE_UNSPECIFIED if
 * the agent never reported one.
 */
export async function triggerAgent(
  port: number,
  instruction: string,
  contextId?: string,
): Promise<TaskState> {
  const handle = await startAgentStream(port, instruction, undefined, contextId);
  if (!handle) return TaskState.TASK_STATE_UNSPECIFIED;

  let finalState = TaskState.TASK_STATE_UNSPECIFIED;
  for await (const event of handle.stream) {
    if (event.payload?.$case !== "statusUpdate") continue;
    const state = event.payload.value.status?.state;
    if (state !== undefined) finalState = state;
  }
  return finalState;
}

/**
 * Polls the agent card until the A2A server on `port` answers. Returns true as
 * soon as it does, or false once every attempt has failed.
 *
 * The ports manifest is only rewritten when the A2A servers start, so a port
 * read from it can be hours stale — pointing at a port nothing is listening on.
 * Probing first turns that into one clear log line instead of an undici stack
 * trace from deep inside the stream.
 */
export async function waitForAgentServer(
  port: number,
  attempts = PROBE_ATTEMPTS,
  retryMs = PROBE_RETRY_MS,
): Promise<boolean> {
  /* oxlint-disable eslint/no-await-in-loop -- retries are inherently sequential: probe, then wait, then probe again */
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if ((await probeAgentCard(port)).ok) return true;
    if (attempt < attempts) {
      consola.warn(
        `[a2a-trigger] No A2A server on port ${port} — retrying in ${Math.round(retryMs / 1000)}s (${attempt}/${attempts - 1})`,
      );
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
  /* oxlint-enable eslint/no-await-in-loop */
  return false;
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

/** Unload and remove the scheduler entry for a completed onetime job. */
export async function cleanupOnetimeJob(
  agentName: string,
  jobId: string,
  label: string | undefined,
): Promise<void> {
  await scheduler.cleanupOnetimeJob(agentName, jobId, label);
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

  if (!(await waitForAgentServer(port))) {
    const writtenAt = typeof ports.updatedAt === "string" ? ports.updatedAt : "unknown";
    consola.error(
      `[a2a-trigger] "${manifestKey}" did not run — nothing is answering on port ${port}. ` +
        `DovePaw is not running, or the ports manifest is stale (last written ${writtenAt}).`,
    );
    process.exit(2);
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
    consola.info(`[a2a-trigger] ${manifestKey} finished — state: ${taskStateToJSON(state)}`);

    if (jobId && jobConfig?.schedule?.type === "onetime") {
      await cleanupOnetimeJob(agentName, jobId, jobConfig.label || undefined);
    }

    process.exit(state === TaskState.TASK_STATE_COMPLETED ? 0 : 1);
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
