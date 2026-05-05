/**
 * Start all A2A agent servers with dynamically allocated ports.
 *
 * Uses getAvailablePort() (net.createServer port=0) — no external deps.
 * Writes a2a/.ports.json so the Next.js API route can discover the ports.
 */

import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { consola } from "consola";
import { getAvailablePort, writePortsManifest, createServerFromDef } from "./lib/base-server.js";
import { PORTS_FILE, A2A_SERVERS_PID_FILE, PROCESSING_FILE } from "@/lib/paths";
import { readAgentsConfig } from "@@/lib/agents-config";

const AGENTS = await readAgentsConfig();

consola.box("🐱  Agent A2A Servers\nAllocating dynamic ports and starting up…");

const agentPortList = await Promise.all(AGENTS.map(() => getAvailablePort()));
const agentPorts = Object.fromEntries(AGENTS.map((a, i) => [a.manifestKey, agentPortList[i]]));

for (let i = 0; i < AGENTS.length; i++) {
  createServerFromDef(AGENTS[i], agentPortList[i]);
}

writePortsManifest(agentPorts);

consola.box(
  [
    "✅  All A2A servers running\n",
    ...AGENTS.map((a, i) => `  ${a.displayName.padEnd(22)}:${agentPortList[i]}`),
    "",
    `  📄  Port manifest → ${PORTS_FILE}`,
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

const cleanupProcessing = () => {
  try {
    mkdirSync(dirname(PROCESSING_FILE), { recursive: true });
    writeFileSync(PROCESSING_FILE, "{}");
  } catch {}
};

process.on("SIGINT", () => {
  consola.info("Shutting down A2A servers…");
  cleanupPid();
  cleanupProcessing();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cleanupPid();
  cleanupProcessing();
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
