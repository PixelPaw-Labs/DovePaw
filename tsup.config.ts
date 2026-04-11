import { join } from "node:path";
import { defineConfig } from "tsup";
import { readAgentConfigEntries } from "./lib/agents-config.js";

const agentEntries = await readAgentConfigEntries();

export default defineConfig({
  entry: {
    ...Object.fromEntries(
      agentEntries.map((a) => {
        const entryFile = a.pluginPath
          ? join(a.pluginPath, "agents", a.name, "main.ts")
          : `agents/${a.name}/main.ts`;
        return [`agents/${a.name}`, entryFile];
      }),
    ),
    "a2a-trigger": "lib/a2a-trigger.ts",
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
