#!/usr/bin/env tsx

/**
 * Build & install scheduler agents.
 *
 * Usage:
 *   npm run install-agents          # build + install + reload all agents
 *   npm run install-agents -- --uninstall   # unload + remove all agents
 */

import { execSync } from "node:child_process";
import { agents } from "./scheduler-config/configs.js";
import { SCHEDULER_ROOT } from "./lib/paths.js";
import {
  copyNativePackages,
  deployAgentSdk,
  linkAgents,
  linkAgentSdkToPlugin,
  linkLocalAgentSkills,
  linkPluginSkills,
  unlinkPluginSkills,
} from "./lib/installer.js";
import { scheduler } from "./lib/scheduler.js";
import { listPlugins } from "./lib/plugin-manager.js";

const NATIVE_PACKAGES = ["@ladybugdb/core"];
const uninstall = process.argv.includes("--uninstall");

// ─── Uninstall ───────────────────────────────────────────────────────────────

if (uninstall) {
  if (process.platform !== "win32") {
    console.log("Uninstalling all scheduler agents...\n");
    await Promise.all(agents.map((agent) => scheduler.uninstallAgent(agent)));
  }
  const pluginsToUnlink = await listPlugins();
  if (pluginsToUnlink.length > 0) {
    console.log("\nUnlinking skills...\n");
    await Promise.all(pluginsToUnlink.map((p) => unlinkPluginSkills(p.skillNames)));
  }
  console.log(`\nDone. Scripts remain in ${SCHEDULER_ROOT}/ for manual use.`);
  process.exit(0);
}

// ─── Build ───────────────────────────────────────────────────────────────────

console.log("Step 1: Building TypeScript...\n");
execSync("npx tsup", { stdio: "inherit", cwd: import.meta.dirname });

// ─── Install + load ──────────────────────────────────────────────────────────

console.log("\nStep 2: Linking agents, skills, and deploying SDK...\n");
await linkAgents();
await deployAgentSdk();
const plugins = await listPlugins();
await Promise.all(plugins.map((p) => linkAgentSdkToPlugin(p.path)));
await Promise.all([
  ...plugins.map((p) => linkPluginSkills(p.path, p.skillNames)),
  linkLocalAgentSkills(),
]);
console.log(`  SDK deployed to ~/.dovepaw/sdk — linked to ${plugins.length} plugin(s)`);

if (process.platform === "win32") {
  console.log("\nStep 3: Skipped (unsupported platform).");
  console.log("Step 4: Skipped.");
} else {
  console.log("\nStep 3: Installing scheduler entries...\n");
  await copyNativePackages(NATIVE_PACKAGES);
  await Promise.all(agents.map((agent) => scheduler.installAgent(agent, NATIVE_PACKAGES)));
  console.log("  Done");

  console.log("\nStep 4: Verifying...\n");
  await Promise.all(
    agents.map(async (agent) => {
      const ok = await scheduler.isAgentLoaded(scheduler.agentLabel(agent));
      console.log(`  ${ok ? "OK" : "WARN"}: ${agent.name}`);
    }),
  );
}

console.log("\nDone!");
