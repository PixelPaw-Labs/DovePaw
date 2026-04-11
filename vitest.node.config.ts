import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts", "packages/agent-sdk/src/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
