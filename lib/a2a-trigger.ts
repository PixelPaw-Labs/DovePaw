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
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { ClientFactory } from "@a2a-js/sdk/client";
import { portsFile } from "./paths";

const PORTS_FILE = portsFile(7473);

export async function triggerAgent(port: number, instruction: string): Promise<string> {
  const factory = new ClientFactory();
  const client = await factory.createFromUrl(`http://127.0.0.1:${port}`);

  const result = await client.sendMessage({
    message: {
      kind: "message",
      messageId: randomUUID(),
      role: "user",
      parts: [{ kind: "text", text: instruction }],
    },
    configuration: { blocking: true },
  });

  if (result.kind === "task") return result.status.state;
  return "unknown";
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
