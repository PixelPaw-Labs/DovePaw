import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // agents/lib is a symlink to the plugin repo — exclude its tests here.
    // The a2a-trigger test lives in lib/__tests__/ (covered by lib/**/*.test.ts).
    include: ["lib/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
    globals: true,
  },
});
