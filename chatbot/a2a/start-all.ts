/**
 * Start all A2A agent servers with dynamically allocated ports.
 *
 * Uses getAvailablePort() (net.createServer port=0) — no external deps.
 * Writes a2a/.ports.json so the Next.js API route can discover the ports.
 */

import { consola } from "consola";
import { getAvailablePort, writePortsManifest, createServerFromDef } from "./lib/base-server.js";
import { startHeartbeatServer } from "./heartbeat-server.js";
import { WS_PORT } from "./heartbeat-types.js";
import { PORTS_FILE } from "@/lib/paths";
import { AGENTS } from "@@/lib/agents";

consola.box("🐱  Agent A2A Servers\nAllocating dynamic ports and starting up…");

const ports = await Promise.all(AGENTS.map(() => getAvailablePort()));

const manifest = Object.fromEntries(AGENTS.map((a, i) => [a.manifestKey, ports[i]]));

for (let i = 0; i < AGENTS.length; i++) {
  createServerFromDef(AGENTS[i], ports[i]);
}

const typedManifest = manifest as Parameters<typeof writePortsManifest>[0];
writePortsManifest(typedManifest);
startHeartbeatServer({ ...typedManifest, updatedAt: new Date().toISOString() });

consola.box(
  [
    "✅  All A2A servers running\n",
    ...AGENTS.map((a, i) => `  ${a.displayName.padEnd(22)}:${ports[i]}`),
    "",
    `  📄  Port manifest → ${PORTS_FILE}`,
    `  🔌  Heartbeat WS   → ws://127.0.0.1:${WS_PORT}`,
  ].join("\n"),
);

consola.info("Ready — waiting for chatbot connections via A2A SSE");

process.on("SIGINT", () => {
  consola.info("Shutting down A2A servers…");
  process.exit(0);
});
