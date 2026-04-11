/**
 * Trigger a DovePaw agent via the A2A server.
 *
 * Usage: a2a-trigger.mjs <manifestKey> [instruction]
 *
 * Reads ~/.dovepaw/.ports.<port>.json to find the agent's port, sends a blocking
 * message via the A2A ClientFactory, and exits when the task reaches a
 * terminal state.
 *
 * @a2a-js/sdk is treated as external (not bundled) and deployed alongside
 * this script in ~/.claude/scheduler/node_modules/ — same pattern as
 * @ladybugdb/core.
 *
 * Exit codes:
 *   0 — task completed successfully
 *   1 — task failed, canceled, or server unavailable
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startAgentStream } from "./a2a-client";
import { portsFile } from "./paths";

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

async function main(): Promise<void> {
  const manifestKey = process.argv[2];
  const instruction = process.argv[3] ?? "";

  if (!manifestKey) {
    console.error("Usage: a2a-trigger.mjs <manifestKey> [instruction]");
    process.exit(1);
  }

  let ports: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(readFileSync(PORTS_FILE, "utf-8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      console.error("Invalid ports manifest format");
      process.exit(1);
    }
    ports = Object.fromEntries(Object.entries(raw));
  } catch {
    console.error(`DovePaw A2A is not running — ${PORTS_FILE} not found`);
    process.exit(1);
  }

  const port = ports[manifestKey];
  if (typeof port !== "number") {
    console.error(`Agent "${manifestKey}" not found in ports manifest`);
    process.exit(1);
  }

  console.log(`[a2a-trigger] ${manifestKey} → port ${port}`);

  try {
    const state = await triggerAgent(port, instruction);
    console.log(`[a2a-trigger] ${manifestKey} finished — state: ${state}`);
    process.exit(state === "completed" ? 0 : 1);
  } catch (err) {
    console.error(`[a2a-trigger] Failed to reach A2A server on port ${port}:`, err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("[a2a-trigger] Fatal:", err);
    process.exit(1);
  });
}
