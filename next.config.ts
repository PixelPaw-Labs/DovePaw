import type { NextConfig } from "next";

const root = import.meta.dirname;

/** Minimal webpack config shape covering the fields this file touches. */
interface WebpackConfig {
  resolve?: {
    alias?: Record<string, string | string[] | false>;
    extensionAlias?: Record<string, string[]>;
  };
  [key: string]: unknown;
}

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
    "better-sqlite3",
  ],
  turbopack: {
    resolveAlias: {
      "@@": root,
    },
  },
  webpack(config: WebpackConfig): WebpackConfig {
    config.resolve ??= {};
    config.resolve.alias = { ...config.resolve.alias, "@@": root };
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
