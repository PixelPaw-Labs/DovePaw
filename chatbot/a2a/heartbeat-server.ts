/**
 * WebSocket heartbeat server — pings each agent's A2A agent-card endpoint
 * every INTERVAL_MS and broadcasts live status to all connected clients.
 *
 * Binds to port 0 (OS-assigned). Returns the actual port via Promise so the
 * caller can write it into the ports manifest for client discovery.
 *
 * Message shape (server → client):
 *   { type: "status", agents: { [manifestKey]: { online: boolean, latency: number | null } } }
 */

import { WebSocketServer, WebSocket } from "ws";
import { consola } from "consola";
import type { AgentStatus, StatusMessage } from "./heartbeat-types.js";
import { getSchedulerStatuses } from "@/lib/agent-scheduler";
import {
  isProcessing,
  getProcessingTrigger,
  onProcessingChange,
} from "./lib/processing-registry.js";
const INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 5_000;

/** Last known heartbeat state, updated every INTERVAL_MS. Module-scope so other
 *  server-side code (e.g. AgentConfigReader) can read live agent status without
 *  re-pinging or reading the ports manifest. */
let lastStatus: Record<string, AgentStatus> = {};
let heartbeatReady = false;

/** Returns true once the first heartbeat cycle has completed and lastStatus is populated. */
export function isHeartbeatReady(): boolean {
  return heartbeatReady;
}

/** Returns true if the agent with the given manifestKey was online in the most
 *  recent heartbeat cycle. Returns false when no heartbeat has run yet. */
export function isAgentOnline(manifestKey: string): boolean {
  return lastStatus[manifestKey]?.online ?? false;
}

async function pingAgent(port: number): Promise<Pick<AgentStatus, "online" | "latency">> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`http://localhost:${port}/.well-known/agent-card.json`, {
      signal: controller.signal,
    });
    const latency = Date.now() - t0;
    return { online: res.ok, latency };
  } catch {
    return { online: false, latency: null };
  } finally {
    clearTimeout(timer);
  }
}

async function checkAll(agentPorts: Record<string, number>): Promise<Record<string, AgentStatus>> {
  const keys = Object.keys(agentPorts);
  const [pingResults, schedulerMap] = await Promise.all([
    Promise.all(keys.map((k) => pingAgent(agentPorts[k]))),
    getSchedulerStatuses(),
  ]);
  return Object.fromEntries(
    keys.map((k, i) => [
      k,
      {
        ...pingResults[i],
        scheduler: schedulerMap[k] ?? null,
        processing: isProcessing(k),
        processingTrigger: getProcessingTrigger(k),
      },
    ]),
  );
}

export function startHeartbeatServer(agentPorts: Record<string, number>): Promise<number> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });

    function broadcast(msg: StatusMessage) {
      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    }

    async function heartbeat() {
      lastStatus = await checkAll(agentPorts);
      heartbeatReady = true;
      broadcast({ type: "status", agents: lastStatus });
    }

    wss.on("connection", (ws) => {
      // Send current status immediately so the client doesn't wait for the next interval
      if (Object.keys(lastStatus).length > 0) {
        ws.send(JSON.stringify({ type: "status", agents: lastStatus }));
      }
    });

    wss.on("listening", () => {
      const addr = wss.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unexpected address type from WebSocketServer"));
        return;
      }
      consola.success(`Heartbeat WS  →  ws://127.0.0.1:${addr.port}`);
      // Run first check immediately, then on interval
      void heartbeat();
      setInterval(() => void heartbeat(), INTERVAL_MS);
      // Broadcast immediately whenever processing state changes (no 10s wait)
      onProcessingChange(() => void heartbeat());
      resolve(addr.port);
    });

    wss.on("error", reject);
  });
}
