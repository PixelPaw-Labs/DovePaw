import type { Configuration } from "electron-builder";

const config: Configuration = {
  appId: "com.dovepaw.dovepawa2a",
  productName: "DovePaw A2A",
  directories: {
    output: "electron/release",
  },
  files: ["electron/.dist/**/*", "electron/assets/**/*"],
  mac: {
    category: "public.app-category.developer-tools",
    target: [{ target: "dmg", arch: ["arm64", "x64"] }],
    icon: "electron/assets/app-icon.icns",
  },
  extraMetadata: {
    main: "electron/.dist/main.cjs",
  },
};

export default config;
