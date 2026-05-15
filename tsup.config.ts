import { defineConfig } from "tsup";
import { readAgentConfigEntries } from "./lib/agents-config.js";
import { buildTsupEntries } from "./scripts/tsup-entries.js";

const agentEntries = await readAgentConfigEntries();

export default defineConfig({
  entry: {
    ...buildTsupEntries(agentEntries),
    "a2a-trigger": "lib/a2a-trigger.ts",
  },
  format: "esm",
  outDir: "dist",
  bundle: true,
  splitting: false,
  external: ["@ladybugdb/core", "@a2a-js/sdk", "undici"], // native addon + SDK + undici deployed to scheduler separately
  platform: "node",
  target: "node24",
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
});
