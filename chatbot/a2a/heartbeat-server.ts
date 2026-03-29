/**
 * WebSocket heartbeat server — pings each agent's A2A agent-card endpoint
 * every INTERVAL_MS and broadcasts live status to all connected clients.
 *
 * Port: WS_PORT (Next.js runs on 7473)
 *
 * Message shape (server → client):
 *   { type: "status", agents: { [manifestKey]: { online: boolean, latency: number | null } } }
 */

import { WebSocketServer, WebSocket } from "ws";
import { consola } from "consola";
import type { PortsManifest } from "./lib/base-server.js";
import { WS_PORT } from "./heartbeat-types.js";
import type { AgentStatus, StatusMessage } from "./heartbeat-types.js";
import { getLaunchdStatuses } from "@/lib/launchd";
import { isProcessing, getProcessingTrigger } from "./lib/processing-registry.js";
const INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 5_000;

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

function isPortKey(
  k: string,
  manifest: PortsManifest,
): k is keyof Omit<PortsManifest, "updatedAt"> {
  return k !== "updatedAt" && k in manifest;
}

async function checkAll(manifest: PortsManifest): Promise<Record<string, AgentStatus>> {
  const keys = Object.keys(manifest).filter((k): k is keyof Omit<PortsManifest, "updatedAt"> =>
    isPortKey(k, manifest),
  );
  const [pingResults, launchdMap] = await Promise.all([
    Promise.all(keys.map((k) => pingAgent(manifest[k]))),
    getLaunchdStatuses(),
  ]);
  return Object.fromEntries(
    keys.map((k, i) => [
      k,
      {
        ...pingResults[i],
        launchd: launchdMap[k] ?? null,
        processing: isProcessing(k),
        processingTrigger: getProcessingTrigger(k),
      },
    ]),
  );
}

export function startHeartbeatServer(manifest: PortsManifest): void {
  const wss = new WebSocketServer({ port: WS_PORT, host: "127.0.0.1" });

  let current: Record<string, AgentStatus> = {};

  function broadcast(msg: StatusMessage) {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  async function heartbeat() {
    current = await checkAll(manifest);
    broadcast({ type: "status", agents: current });
  }

  wss.on("connection", (ws) => {
    // Send current status immediately so the client doesn't wait for the next interval
    if (Object.keys(current).length > 0) {
      ws.send(JSON.stringify({ type: "status", agents: current }));
    }
  });

  wss.on("listening", () => {
    consola.success(`Heartbeat WS  →  ws://127.0.0.1:${WS_PORT}`);
  });

  // Run first check immediately, then on interval
  void heartbeat();
  setInterval(() => void heartbeat(), INTERVAL_MS);
}
