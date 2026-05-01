import { defineConfig } from "vitest/config";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = import.meta.dirname;
const agentsRoot = resolve(root, "agents");

// `agents/` is a symlink to `~/.dovepaw/plugins/` created by `npm run install`.
// Include plugin-repo tests only when the symlink resolves to a live directory
// — otherwise vitest would error on a dangling glob root. On a fresh worktree
// or after uninstalling every plugin, agents/ may not exist at all; the guard
// makes `npm run agents:test` still succeed and just run the built-in node
// tests (lib, scripts, packages/agent-sdk).
const agentsLive = existsSync(agentsRoot) && statSync(agentsRoot).isDirectory();

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "chatbot"),
      "@@": root,
    },
  },
  test: {
    include: [
      "lib/**/*.test.ts",
      "scripts/**/*.test.ts",
      "packages/agent-sdk/src/**/*.test.ts",
      ...(agentsLive ? ["agents/**/__tests__/**/*.test.ts"] : []),
    ],
    environment: "node",
    globals: true,
    passWithNoTests: true,
  },
});
