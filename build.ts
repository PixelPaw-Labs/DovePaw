#!/usr/bin/env tsx

/**
 * Build & install scheduler agents.
 *
 * Usage:
 *   npm run install-agents          # build + install + reload all agents
 *   npm run install-agents -- --uninstall   # unload + remove all agents
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { agents } from "./plist/configs.js";
import { SCHEDULER_ROOT } from "./lib/paths.js";
import { getUid, copyNativePackages, installAgent, uninstallAgent, isAgentLoaded } from "./lib/installer.js";

const SKILLS_DIR = join(import.meta.dirname, "skills");
const CLAUDE_SKILLS_DIR = join(process.env.HOME!, ".claude/skills");

function linkSkills() {
  mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });
  for (const skill of readdirSync(SKILLS_DIR)) {
    const target = join(SKILLS_DIR, skill);
    const link = join(CLAUDE_SKILLS_DIR, skill);
    if (existsSync(link)) rmSync(link, { recursive: true, force: true });
    symlinkSync(target, link);
    console.log(`  linked: ${skill}`);
  }
}

function unlinkSkills() {
  for (const skill of readdirSync(SKILLS_DIR)) {
    const link = join(CLAUDE_SKILLS_DIR, skill);
    if (existsSync(link)) {
      rmSync(link, { recursive: true, force: true });
      console.log(`  unlinked: ${skill}`);
    }
  }
}

const NATIVE_PACKAGES = ["@ladybugdb/core"];
const uid = getUid();
const uninstall = process.argv.includes("--uninstall");

// ─── Uninstall ───────────────────────────────────────────────────────────────

if (uninstall) {
  console.log("Uninstalling all scheduler agents...\n");
  await Promise.all(agents.map((agent) => uninstallAgent(agent, uid)));
  console.log("\nUnlinking skills...\n");
  unlinkSkills();
  console.log(`\nDone. Scripts remain in ${SCHEDULER_ROOT}/ for manual use.`);
  process.exit(0);
}

// ─── Build ───────────────────────────────────────────────────────────────────

console.log("Step 1: Building TypeScript...\n");
execSync("npx tsup", { stdio: "inherit", cwd: import.meta.dirname });

// ─── Install + load ──────────────────────────────────────────────────────────

console.log("\nStep 2: Linking skills...\n");
linkSkills();

console.log("\nStep 3: Installing and loading agents...\n");
await copyNativePackages(NATIVE_PACKAGES);
await Promise.all(agents.map((agent) => installAgent(agent, uid, [])));
console.log("  Done");

// ─── Verify ──────────────────────────────────────────────────────────────────

console.log("\nStep 4: Verifying...\n");
await Promise.all(
  agents.map(async (agent) => {
    const ok = await isAgentLoaded(agent.label);
    console.log(`  ${ok ? "OK" : "WARN"}: ${agent.name}`);
  }),
);

console.log("\nDone!");
