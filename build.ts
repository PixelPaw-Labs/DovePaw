#!/usr/bin/env tsx

/**
 * Build & install scheduler agents.
 *
 * Usage:
 *   npm run install-agents          # build + install + reload all agents
 *   npm run install-agents -- --uninstall   # unload + remove all agents
 */

import { execSync } from "node:child_process";
import { agents } from "./plist/configs.js";
import { SCHEDULER_ROOT } from "./lib/paths.js";
import {
  getUid,
  copyNativePackages,
  deployAgentSdk,
  installAgent,
  uninstallAgent,
  isAgentLoaded,
  linkAgents,
  linkAgentSdkToPlugin,
  linkPluginSkills,
  unlinkPluginSkills,
} from "./lib/installer.js";
import { plistLabel } from "./lib/plist-generate.js";
import { listPlugins } from "./lib/plugin-manager.js";

const NATIVE_PACKAGES = ["@ladybugdb/core"];
const uid = getUid();
const uninstall = process.argv.includes("--uninstall");

// ─── Uninstall ───────────────────────────────────────────────────────────────

if (uninstall) {
  if (process.platform === "darwin") {
    console.log("Uninstalling all scheduler agents...\n");
    await Promise.all(agents.map((agent) => uninstallAgent(agent, uid)));
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
await Promise.all(plugins.map((p) => linkPluginSkills(p.path, p.skillNames)));
console.log(`  SDK deployed to ~/.dovepaw/sdk — linked to ${plugins.length} plugin(s)`);

if (process.platform === "darwin") {
  console.log("\nStep 3: Installing and loading agents...\n");
  await copyNativePackages(NATIVE_PACKAGES);
  await Promise.all(agents.map((agent) => installAgent(agent, uid, [])));
  console.log("  Done");

  // ─── Verify ────────────────────────────────────────────────────────────────

  console.log("\nStep 4: Verifying...\n");
  await Promise.all(
    agents.map(async (agent) => {
      const ok = await isAgentLoaded(plistLabel(agent));
      console.log(`  ${ok ? "OK" : "WARN"}: ${agent.name}`);
    }),
  );
} else {
  console.log("\nStep 3: Skipped (launchd not available on this platform).");
  console.log("Step 4: Skipped.");
}

console.log("\nDone!");
