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
import { setMaxListeners } from "node:events";
import { z } from "zod";
import { consola } from "consola";
import express from "express";
import { AGENT_CARD_PATH } from "@a2a-js/sdk";
import type { AgentCard } from "@a2a-js/sdk";
import type {
  AgentExecutor,
  ExecutionEventBusManager,
  ExecutionEventBus,
} from "@a2a-js/sdk/server";
import type { AgentDef } from "@@/lib/agents";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  DefaultExecutionEventBusManager,
} from "@a2a-js/sdk/server";
import {
  agentCardHandler,
  jsonRpcHandler,
  restHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import { QueryAgentExecutor } from "./query-agent-executor";
import type { ExecutorPublisher } from "./executor-publisher";
export { portsManifestSchema, writePortsManifest, readPortsManifest } from "./ports-manifest";
export type { PortsManifest } from "./ports-manifest";
import { SessionManager } from "@/lib/session-manager";

// ─── Event bus manager ────────────────────────────────────────────────────────

// DefaultExecutionEventBus extends EventTarget, which Node.js caps at 10 listeners.
// With many concurrent SSE clients (group mode, multiple tabs), that limit is hit.
// This wrapper raises it to Infinity on each newly created bus.
class UnboundedEventBusManager implements ExecutionEventBusManager {
  private readonly inner = new DefaultExecutionEventBusManager();

  createOrGetByTaskId(taskId: string): ExecutionEventBus {
    const bus = this.inner.createOrGetByTaskId(taskId);
    if (bus instanceof EventTarget) {
      setMaxListeners(Infinity, bus);
    }
    return bus;
  }

  getByTaskId(taskId: string): ExecutionEventBus | undefined {
    return this.inner.getByTaskId(taskId);
  }

  cleanupByTaskId(taskId: string): void {
    this.inner.cleanupByTaskId(taskId);
  }
}

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

// ─── Server factory ───────────────────────────────────────────────────────────

/**
 * Create and start an A2A Express server on the given dynamic port.
 * The agentCard.url is updated to reflect the actual port.
 */
export function createAgentServer(
  agentCard: AgentCard,
  executor: AgentExecutor,
  port: number,
  sessionManager?: SessionManager,
  publisherRegistry?: Map<string, ExecutorPublisher>,
): void {
  const card: AgentCard = {
    ...agentCard,
    url: `http://localhost:${port}/a2a/jsonrpc`,
    additionalInterfaces: [
      { url: `http://localhost:${port}/a2a/jsonrpc`, transport: "JSONRPC" },
      { url: `http://localhost:${port}/a2a/rest`, transport: "HTTP+JSON" },
    ],
  };

  const handler = new DefaultRequestHandler(
    card,
    new InMemoryTaskStore(),
    executor,
    new UnboundedEventBusManager(),
  );
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

  app.use(express.json());

  if (sessionManager) {
    app.get("/sessions", (_req, res) => res.json(sessionManager.getSessions()));
    app.post("/session/clear", (req, res) => {
      const body: unknown = req.body;
      const { contextId } = z.object({ contextId: z.string() }).parse(body);
      sessionManager.delete(contextId);
      res.json({ ok: true });
    });
  }

  if (publisherRegistry) {
    app.post("/internal/tasks/:taskId/progress", (req, res) => {
      const { taskId } = req.params;
      const parsed = z
        .object({ message: z.string(), artifacts: z.record(z.string(), z.string()).optional() })
        .safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
      }
      const publisher = publisherRegistry.get(taskId);
      if (!publisher) {
        res.status(404).json({ error: `No active publisher for task ${taskId}` });
        return;
      }
      publisher.publishStatusToUI(parsed.data.message, parsed.data.artifacts);
      res.json({ ok: true });
    });
  }

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

  const sessionManager = new SessionManager();
  const publisherRegistry = new Map<string, ExecutorPublisher>();
  const executor = new QueryAgentExecutor(def, sessionManager, publisherRegistry, port);
  createAgentServer(agentCard, executor, port, sessionManager, publisherRegistry);
}
