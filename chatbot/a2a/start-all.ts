/**
 * Start all A2A agent servers with dynamically allocated ports.
 *
 * Uses getAvailablePort() (net.createServer port=0) — no external deps.
 * Writes a2a/.ports.json so the Next.js API route can discover the ports.
 */

import { writeFileSync, rmSync } from "node:fs";
import { consola } from "consola";
import { getAvailablePort, writePortsManifest, createServerFromDef } from "./lib/base-server.js";
import { createGroupServer, groupManifestKey } from "./lib/group-server.js";
import { startHeartbeatServer } from "./heartbeat-server.js";
import { PORTS_FILE, A2A_SERVERS_PID_FILE } from "@/lib/paths";
import { readAgentsConfig } from "@@/lib/agents-config";
import { readAgentLinksFile } from "@@/lib/agent-links";

const AGENTS = await readAgentsConfig();
const linksFile = await readAgentLinksFile();
const GROUPS = linksFile.groups.filter((g) => g.members.length >= 2);

consola.box("🐱  Agent A2A Servers\nAllocating dynamic ports and starting up…");

const agentPortList = await Promise.all(AGENTS.map(() => getAvailablePort()));
const groupPortList = await Promise.all(GROUPS.map(() => getAvailablePort()));

const agentPorts = Object.fromEntries(AGENTS.map((a, i) => [a.manifestKey, agentPortList[i]]));
const groupPorts = Object.fromEntries(
  GROUPS.map((g, i) => [groupManifestKey(g.name), groupPortList[i]]),
);

for (let i = 0; i < AGENTS.length; i++) {
  createServerFromDef(AGENTS[i], agentPortList[i]);
}

for (let i = 0; i < GROUPS.length; i++) {
  createGroupServer(GROUPS[i], AGENTS, groupPortList[i]);
}

const wsPort = await startHeartbeatServer(agentPorts);
writePortsManifest({ ...agentPorts, ...groupPorts, ws_port: wsPort });

consola.box(
  [
    "✅  All A2A servers running\n",
    ...AGENTS.map((a, i) => `  ${a.displayName.padEnd(22)}:${agentPortList[i]}`),
    ...(GROUPS.length > 0
      ? [
          "",
          "  Groups:",
          ...GROUPS.map((g, i) => `  [${g.name}]`.padEnd(24) + `:${groupPortList[i]}`),
        ]
      : []),
    "",
    `  📄  Port manifest → ${PORTS_FILE}`,
    `  🔌  Heartbeat WS   → ws://127.0.0.1:${wsPort}`,
  ].join("\n"),
);

consola.info("Ready — waiting for chatbot connections via A2A SSE");

// Write PID so the chatbot UI can signal a restart via /api/servers/restart
writeFileSync(A2A_SERVERS_PID_FILE, String(process.pid), "utf-8");
const cleanupPid = () => {
  try {
    rmSync(A2A_SERVERS_PID_FILE);
  } catch {}
};

process.on("SIGINT", () => {
  consola.info("Shutting down A2A servers…");
  cleanupPid();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupPid();
  process.exit(0);
});

// The Claude Agent SDK's handleControlRequest calls write() to the claude CLI stdin
// after the process is killed on task cancellation. The rejected promise escapes
// uncaught — swallow it silently since it's expected on abort.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg === "Operation aborted") return;
  consola.error("A2A servers — unhandledRejection:", reason);
});
