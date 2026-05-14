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
