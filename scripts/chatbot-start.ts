/**
 * Start A2A servers + Next.js dev on dynamically allocated ports.
 *
 * 1. Picks a free TCP port for Next.js via the OS (port 0 trick).
 * 2. Sets DOVEPAW_PORT in the environment so both child processes scope
 *    their .ports.<N>.json manifest to the same file.
 * 3. Spawns concurrently: a2a servers + next dev -p <N>.
 */

import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function buildConcurrentlyCommand(port: number): string {
  return `npx concurrently --kill-others-on-fail --names "a2a,next" --prefix-colors "cyan.bold,magenta.bold" --prefix "[{name}]" "npm run chatbot:servers" "npx next dev chatbot -p ${port}"`;
}

function getAvailablePort(): Promise<number> {
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

const port = await getAvailablePort();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, DOVEPAW_PORT: String(port) };

const proc = spawn(buildConcurrentlyCommand(port), {
  env,
  stdio: "inherit",
  cwd: root,
  shell: true,
});

proc.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => proc.kill("SIGINT"));
process.on("SIGTERM", () => proc.kill("SIGTERM"));
