/**
 * Shared agent installation primitives used by both build.ts (CLI) and
 * launchd.ts (chatbot).
 *
 * Cross-platform functions live here. macOS-specific (launchd/plist) functions
 * live in lib/macos/installer.ts and are re-exported below for backward compat.
 */

import { mkdir, rm, cp, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_SDK_DIR,
  AGENT_SDK_SRC,
  AGENTS_ROOT,
  CODEX_SKILLS_ROOT,
  DOVEPAW_TMP_DIR,
  PLUGINS_DIR,
  SKILLS_ROOT,
  agentNodeModule,
} from "./paths";

/**
 * Copy packages/agent-sdk/ to ~/.dovepaw/sdk/ so plugin repos can reference it
 * as a file: dependency and tsup can bundle it.
 */
export async function deployAgentSdk(): Promise<void> {
  await rm(AGENT_SDK_DIR, { recursive: true, force: true });
  await cp(AGENT_SDK_SRC, AGENT_SDK_DIR, { recursive: true });
  // Symlink SDK peer deps into ~/.dovepaw/sdk/node_modules/ so Node.js resolves
  // them from the real file path (not the symlinked plugin path).
  const sdkNmScope = join(AGENT_SDK_DIR, "node_modules", "@openai");
  await mkdir(sdkNmScope, { recursive: true });
  const codexSdkLink = join(sdkNmScope, "codex-sdk");
  await rm(codexSdkLink, { recursive: true, force: true });
  await symlink(agentNodeModule("@openai/codex-sdk"), codexSdkLink);
  // Ensure ~/.dovepaw/tmp/ is treated as ESM so tsx loads tmp agent scripts
  // in ESM mode. Without this, Node.js defaults to CJS and require()ing the
  // ESM-only @openai/codex-sdk (transitively via the SDK index) fails with
  // ERR_PACKAGE_PATH_NOT_EXPORTED.
  await mkdir(DOVEPAW_TMP_DIR, { recursive: true });
  await writeFile(join(DOVEPAW_TMP_DIR, "package.json"), '{"type":"module"}\n', "utf-8");
}

/**
 * Create <pluginDir>/node_modules/@dovepaw/agent-sdk → ~/.dovepaw/sdk symlink
 * so plugin agents resolve @dovepaw/agent-sdk at both tsx runtime and tsup bundle time.
 */
export async function linkAgentSdkToPlugin(pluginDir: string): Promise<void> {
  const nmScope = join(pluginDir, "node_modules", "@dovepaw");
  await mkdir(nmScope, { recursive: true });
  const link = join(nmScope, "agent-sdk");
  await rm(link, { recursive: true, force: true });
  await symlink(AGENT_SDK_DIR, link);
}

/** Ensure DovePaw/agents -> ~/.dovepaw/plugins symlink exists. */
export async function linkAgents(): Promise<void> {
  await mkdir(PLUGINS_DIR, { recursive: true });
  const link = join(AGENTS_ROOT, "agents");
  try {
    await symlink(PLUGINS_DIR, link);
  } catch (e: unknown) {
    if (e instanceof Error && (e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
}

/** Symlink a plugin's skills into ~/.claude/skills/ and ~/.codex/skills/. */
export async function linkPluginSkills(pluginDir: string, skillNames: string[]): Promise<void> {
  if (skillNames.length === 0) return;
  await Promise.all(
    [SKILLS_ROOT, CODEX_SKILLS_ROOT].flatMap((root) =>
      skillNames.map(async (skill) => {
        await mkdir(root, { recursive: true });
        const link = join(root, skill);
        await rm(link, { recursive: true, force: true });
        await symlink(join(pluginDir, "skills", skill), link);
      }),
    ),
  );
}

/** Remove ~/.claude/skills/ and ~/.codex/skills/ symlinks for a plugin's skills. */
export async function unlinkPluginSkills(skillNames: string[]): Promise<void> {
  await Promise.all(
    [SKILLS_ROOT, CODEX_SKILLS_ROOT].flatMap((root) =>
      skillNames.map((skill) => rm(join(root, skill), { recursive: true, force: true })),
    ),
  );
}

// Re-export macOS-specific functions for backward compatibility.
// New code should import directly from lib/macos/installer.
export * from "./macos/installer";
