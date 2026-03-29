import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "electron/main.ts" },
  format: "cjs",
  outDir: "electron/.dist",
  bundle: true,
  splitting: false,
  platform: "node",
  target: "node24",
  external: ["electron"],
  clean: true,
});
