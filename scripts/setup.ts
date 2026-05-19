#!/usr/bin/env tsx
/**
 * Usage:
 *   tsx scripts/setup.ts            # common setup only
 *   tsx scripts/setup.ts --install  # common setup + tsup + register scheduler
 *   npm run uninstall                # unload and remove all scheduler entries
 */

import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { agents } from "../scheduler-config/configs.js";
import { SCHEDULER_ROOT } from "../lib/paths.js";
import {
  copyNativePackages,
  deployAgentSdk,
  deployHandoffScript,
  linkAgents,
  linkAgentSdkToAgentLocal,
  linkAgentSdkToPlugin,
  linkLocalAgentSkills,
  linkPluginSkills,
  syncAgentLocalToSettings,
  syncClaudeRules,
  syncOutputStyles,
  unlinkPluginSkills,
} from "../lib/installer.js";
import { scheduler } from "../lib/scheduler.js";
import { listPlugins } from "../lib/plugin-manager.js";

const NATIVE_PACKAGES = ["@ladybugdb/core"];
const install = process.argv.includes("--install");
const uninstall = process.argv.includes("--uninstall");

// ─── Uninstall ────────────────────────────────────────────────────────────────

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

// ─── Common setup (always runs) ───────────────────────────────────────────────

await linkAgents();
await deployAgentSdk();
await deployHandoffScript();
await linkAgentSdkToAgentLocal();
const plugins = await listPlugins();
await Promise.all([
  ...plugins.map((p) => linkAgentSdkToPlugin(p.path)),
  ...plugins.map((p) => linkPluginSkills(p.path, p.skillNames)),
  linkLocalAgentSkills(),
  syncAgentLocalToSettings(),
  syncClaudeRules(),
  syncOutputStyles(),
]);
console.log(`  SDK deployed — linked to ${plugins.length} plugin(s)`);

// ─── Install: compile + register scheduler ───────────────────────────────────

if (install) {
  console.log("\nBuilding TypeScript...\n");
  execSync("npx tsup", { stdio: "inherit", cwd: resolve(import.meta.dirname, "..") });

  if (process.platform !== "win32") {
    console.log("\nInstalling scheduler entries...\n");
    await copyNativePackages(NATIVE_PACKAGES);
    await Promise.all(agents.map((agent) => scheduler.installAgent(agent, NATIVE_PACKAGES)));

    console.log("\nVerifying...\n");
    await Promise.all(
      agents.map(async (agent) => {
        const ok = await scheduler.isAgentLoaded(scheduler.agentLabel(agent));
        console.log(`  ${ok ? "OK" : "WARN"}: ${agent.name}`);
      }),
    );
  }

  console.log("\nDone!");
}
