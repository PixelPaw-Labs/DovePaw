/**
 * A2A server factory and port utilities.
 *
 * Executors live in their own files:
 *   - script-agent-executor.ts  — spawns tsx script directly, streams stdout
 *   - query-agent-executor.ts   — runs a query() sub-agent with inner MCP tools
 *
 * Script spawning helpers (AgentConfig, extractInstruction, buildScriptArgs,
 * spawnAndCollect) live in spawn.ts to avoid circular imports.
 *
 * Dynamic ports: call `getAvailablePort()` to let the OS assign a free port
 * (uses net.createServer with port 0 — no external deps).
 *
 * Port manifest: `start-all.ts` writes `a2a/.ports.json` after all servers
 * start; the Next.js API route reads it at request time.
 */

import { createServer } from "node:net";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { consola } from "consola";
import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import type { AgentCard } from "@a2a-js/sdk";
import type { AgentExecutor } from "@a2a-js/sdk/server";
import type { AgentDef } from "@@/lib/agents";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { PORTS_FILE } from "@/lib/paths";
import { z } from "zod";
import { QueryAgentExecutor } from "./query-agent-executor";

// ─── Port utilities ───────────────────────────────────────────────────────────

/**
 * Ask the OS for a free TCP port by binding a temporary server to port 0.
 * Built-in Node.js `net` module — no external dependencies.
 */
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unexpected address type after listen()"));
        return;
      }
      server.close(() => resolve(addr.port));
    });
    server.on("error", reject);
  });
}

export const portsManifestSchema = z.object({
  experience_reflector: z.number(),
  get_shit_done: z.number(),
  release_log_sentinel: z.number(),
  memory_distiller: z.number(),
  oncall_analyzer: z.number(),
  updatedAt: z.string(),
});

export type PortsManifest = z.infer<typeof portsManifestSchema>;

export function writePortsManifest(ports: Omit<PortsManifest, "updatedAt">): void {
  const manifest: PortsManifest = { ...ports, updatedAt: new Date().toISOString() };
  writeFileSync(PORTS_FILE, JSON.stringify(manifest, null, 2));
}

export function readPortsManifest(): PortsManifest | null {
  if (!existsSync(PORTS_FILE)) return null;
  try {
    const parsed = portsManifestSchema.safeParse(JSON.parse(readFileSync(PORTS_FILE, "utf-8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Create and start an A2A Express server on the given dynamic port.
 * The agentCard.url is updated to reflect the actual port.
 */
export function createAgentServer(
  agentCard: AgentCard,
  executor: AgentExecutor,
  port: number,
): void {
  const card: AgentCard = {
    ...agentCard,
    url: `http://localhost:${port}/a2a/jsonrpc`,
    additionalInterfaces: [
      { url: `http://localhost:${port}/a2a/jsonrpc`, transport: "JSONRPC" },
      { url: `http://localhost:${port}/a2a/rest`, transport: "HTTP+JSON" },
    ],
  };

  const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
  const app = express();

  app.use(`/${AGENT_CARD_PATH}`, agentCardHandler({ agentCardProvider: handler }));
  app.use(
    "/a2a/jsonrpc",
    jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }),
  );
  app.use(
    "/a2a/rest",
    restHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }),
  );

  app.listen(port, "127.0.0.1", () => {
    consola.success(`${card.name}  →  http://localhost:${port}`);
  });
}

/**
 * Build and start an A2A server directly from a shared AgentDef.
 * Uses QueryAgentExecutor so the A2A server runs a query() sub-agent that
 * reasons about the request before spawning the agent script via run_script MCP tool.
 */
export function createServerFromDef(def: AgentDef, port: number): void {
  const agentCard: AgentCard = {
    name: def.displayName,
    description: def.description,
    url: "",
    protocolVersion: "0.3.0",
    version: "1.0.0",
    skills: [],
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text"],
  };

  createAgentServer(agentCard, new QueryAgentExecutor(def), port);
}
