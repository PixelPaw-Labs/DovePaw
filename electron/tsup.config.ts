import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "electron/main.ts",
    preload: "electron/preload.ts",
    "browser-toolbar-preload": "electron/browser-toolbar-preload.ts",
  },
  format: "cjs",
  outDir: "electron/.dist",
  bundle: true,
  splitting: false,
  platform: "node",
  target: "node24",
  external: ["electron"],
  clean: true,
});
