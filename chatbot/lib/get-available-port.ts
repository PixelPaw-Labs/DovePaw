/**
 * Ask the OS for a free TCP port on 127.0.0.1.
 *
 * The same trick `a2a/lib/base-server.ts` uses, lifted into the chatbot lib
 * so files in the Next.js runtime can reach it without dragging in the A2A
 * server bundle (Express, A2A SDK, etc.).
 */
import { createServer } from "node:net";

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
