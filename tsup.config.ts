import { defineConfig } from "tsup";
import { AGENTS } from "./lib/agents.js";

export default defineConfig({
  entry: Object.fromEntries(AGENTS.map((a) => [a.name, a.entryPath])),
  format: "esm",
  outDir: "dist",
  bundle: true,
  splitting: false,
  external: ["@ladybugdb/core"], // native addon — cannot be bundled
  platform: "node",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
  outExtension: () => ({ js: ".mjs" }),
  clean: true,
});
