import type { NextConfig } from "next";

const root = import.meta.dirname;

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "../tsconfig.json",
  },
  // Prevent Next.js from bundling packages that spawn processes or use native modules
  serverExternalPackages: [
    "@anthropic-ai/claude-agent-sdk",
    "@a2a-js/sdk",
    "express",
    "@napi-rs/keyring",
  ],
  turbopack: {
    resolveAlias: {
      "@@": root,
    },
  },
  webpack(config) {
    config.resolve ??= {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, string>),
      "@@": root,
    };
    // Resolve ESM-style .js imports to their .ts counterparts for files
    // outside the Next.js app root (e.g. @@/lib/agents.ts)
    config.resolve.extensionAlias = {
      ".js": [".ts", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
