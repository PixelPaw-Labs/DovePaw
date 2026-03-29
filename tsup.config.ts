import { defineConfig } from "tsup";
import { AGENTS } from "./lib/agents.js";

export default defineConfig({
  entry: {
    ...Object.fromEntries(AGENTS.map((a) => [a.name, a.entryPath])),
    "a2a-trigger": "agents/lib/a2a-trigger.ts",
  },
  format: "esm",
  outDir: "dist",
  bundle: true,
  splitting: false,
  external: ["@ladybugdb/core", "@a2a-js/sdk"], // native addon + SDK deployed to scheduler separately
  platform: "node",
  target: "node24",
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
});
