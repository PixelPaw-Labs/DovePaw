/**
 * Plugin manager — single source of truth for all plugin operations.
 * Called from both the CLI (scripts/plugin.ts) and chatbot API routes.
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm, symlink, unlink } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { agentConfigEntrySchema } from "./agents-config-schemas";
import { readAgentFile, writeAgentFile } from "./agents-config";
import { PLUGINS_DIR, PLUGINS_REGISTRY_FILE, agentConfigDir, agentDefinitionFile } from "./paths";
import { makeEnvVar } from "./settings";
import { pushConfig } from "./s3-config-sync";
import { linkAgentSdkToPlugin, linkPluginSkills, unlinkPluginSkills } from "./installer";
import {
  normalizeSkillTargetPath,
  pluginManifestSchema,
  pluginRecordSchema,
  pluginsRegistrySchema,
  resolvePluginSkillTargets,
  type PluginManifest,
  type PluginRecord,
  type PluginsRegistry,
} from "./plugin-schemas";

const execAsync = promisify(exec);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** owner/repo GitHub slug — no protocol, @, :, or leading slash. Exported for testing. */
export function isGitHubSlug(source: string): boolean {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(source);
}

function isGitUrl(source: string): boolean {
  return source.startsWith("git@") || source.includes("://");
}

/** Derive a candidate directory name from a git URL or slug (last component, strip .git, lowercase). Exported for testing. */
export function repoName(source: string): string {
  const last = source.split("/").pop() ?? source;
  return last.replace(/\.git$/, "").toLowerCase();
}

async function readRegistry(): Promise<PluginsRegistry> {
  try {
    const raw = await readFile(PLUGINS_REGISTRY_FILE, "utf-8");
    const result = pluginsRegistrySchema.safeParse(JSON.parse(raw));
    if (result.success) return result.data;
  } catch {
    // File absent or corrupt — start fresh
  }
  return { version: 1, plugins: [] };
}

async function writeRegistry(registry: PluginsRegistry): Promise<void> {
  await mkdir(PLUGINS_DIR, { recursive: true });
  const data = JSON.stringify(registry, null, 2) + "\n";
  await writeFile(PLUGINS_REGISTRY_FILE, data, "utf-8");
  await pushConfig("plugins.json", data);
}

async function readManifest(pluginDir: string): Promise<PluginManifest> {
  const manifestPath = join(pluginDir, "dovepaw-plugin.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch {
    throw new Error(`dovepaw-plugin.json not found in ${pluginDir}`);
  }
  return pluginManifestSchema.parse(JSON.parse(raw));
}

/**
 * Symlink settings.agents/<name>/agent.json → plugin source so UI edits write
 * directly to the plugin repo and are never reverted by a plugin update.
 *
 * On fresh install: creates the symlink, then writes the initialised AgentFile
 * (version, pluginPath, seeded envVars) through it into the plugin source.
 * On update: refreshes the symlink, then writes back preserving existing user config.
 */
async function upsertAgentSettings(agentName: string, pluginDir: string): Promise<void> {
  const agentJsonPath = join(pluginDir, "agents", agentName, "agent.json");
  let raw: string;
  try {
    raw = await readFile(agentJsonPath, "utf-8");
  } catch {
    throw new Error(`agents/${agentName}/agent.json not found in ${pluginDir}`);
  }

  const entry = agentConfigEntrySchema.parse(JSON.parse(raw));
  // Read existing user config before we touch the symlink (update case)
  const existing = await readAgentFile(agentName);

  const configDir = agentConfigDir(agentName);
  await mkdir(configDir, { recursive: true });

  // (Re-)create symlink: settings.agents/<name>/agent.json → plugin source
  const symlinkPath = agentDefinitionFile(agentName);
  try {
    await unlink(symlinkPath);
  } catch {
    // File absent — nothing to remove
  }
  await symlink(agentJsonPath, symlinkPath);

  const seedEnvVars = (entry.envVars ?? []).map(({ key, value, isSecret }) =>
    makeEnvVar(key, value, isSecret),
  );

  // Write through the symlink into the plugin source; this is how UI edits persist.
  // pluginPath is intentionally omitted — it is derived from the symlink at read time.
  await writeAgentFile(agentName, {
    version: 1,
    ...entry,
    repos: existing?.repos ?? entry.repos ?? [],
    envVars: existing?.envVars ?? seedEnvVars,
    locked: existing?.locked ?? false,
    notifications: existing?.notifications,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a plugin from a git URL or local filesystem path.
 * Clones the repo if a git URL is given; uses the path as-is otherwise.
 * Writes agent settings for each agent in the manifest and updates the registry.
 * Does NOT build or deploy — run `npm run install` afterwards.
 */
export async function addPlugin(source: string): Promise<PluginRecord> {
  source = source.trim();
  let pluginDir: string;
  let gitUrl: string | undefined;

  if (isGitHubSlug(source)) {
    // "owner/repo" — gh CLI understands this directly, no expansion needed
    gitUrl = `https://github.com/${source}`;
    const targetDir = join(PLUGINS_DIR, repoName(source));
    await mkdir(PLUGINS_DIR, { recursive: true });
    if (!existsSync(targetDir)) {
      await execAsync(`gh repo clone ${source} ${targetDir}`);
    }
    pluginDir = targetDir;
  } else if (isGitUrl(source)) {
    gitUrl = source;
    const targetDir = join(PLUGINS_DIR, repoName(source));
    await mkdir(PLUGINS_DIR, { recursive: true });
    if (!existsSync(targetDir)) {
      const cloneCmd = source.includes("github.com")
        ? `gh repo clone ${source} ${targetDir}`
        : `git clone ${source} ${targetDir}`;
      await execAsync(cloneCmd);
    }
    pluginDir = targetDir;
  } else {
    pluginDir = source;
  }

  const manifest = await readManifest(pluginDir);

  // If the manifest name differs from the URL-derived directory name, rename
  if (gitUrl) {
    const expectedDir = join(PLUGINS_DIR, manifest.name);
    if (pluginDir !== expectedDir && !existsSync(expectedDir)) {
      await execAsync(`mv ${pluginDir} ${expectedDir}`);
      pluginDir = expectedDir;
    }
  }

  const registry = await readRegistry();
  const existing = registry.plugins.find((p) => p.name === manifest.name);

  await execAsync(`npm install --prefix ${pluginDir}`);
  await linkAgentSdkToPlugin(pluginDir);
  await linkPluginSkills(pluginDir, manifest.skills, existing?.skillTargets);

  await Promise.all(manifest.agents.map((agentName) => upsertAgentSettings(agentName, pluginDir)));

  const now = new Date().toISOString();

  const record: PluginRecord = pluginRecordSchema.parse({
    name: manifest.name,
    path: pluginDir,
    gitUrl,
    installedAt: existing?.installedAt ?? now,
    version: manifest.version,
    agentNames: manifest.agents,
    skillNames: manifest.skills,
    ...(existing?.skillTargets !== undefined ? { skillTargets: existing.skillTargets } : {}),
  });

  if (existing) {
    const idx = registry.plugins.indexOf(existing);
    registry.plugins[idx] = record;
  } else {
    registry.plugins.push(record);
  }

  await writeRegistry(registry);
  return record;
}

/**
 * Remove a plugin from the registry and delete its agent settings.
 * Does NOT delete the plugin directory itself.
 */
export async function removePlugin(pluginName: string): Promise<void> {
  const registry = await readRegistry();
  const plugin = registry.plugins.find((p) => p.name === pluginName);
  if (!plugin) throw new Error(`Plugin "${pluginName}" is not installed`);

  await Promise.all([
    ...plugin.agentNames.map(async (agentName) => {
      const dir = agentConfigDir(agentName);
      if (existsSync(dir)) await rm(dir, { recursive: true });
    }),
    unlinkPluginSkills(plugin.skillNames, plugin.skillTargets),
  ]);

  registry.plugins = registry.plugins.filter((p) => p.name !== pluginName);
  await writeRegistry(registry);
}

/** Return all installed plugins. Returns [] when no plugins are installed. */
export async function listPlugins(): Promise<PluginRecord[]> {
  const registry = await readRegistry();
  return registry.plugins;
}

/**
 * Re-sync a plugin's agent settings from its manifest without pulling from git.
 * Removes settings for agents no longer in the manifest, upserts current ones.
 */
export async function syncPlugin(pluginName: string): Promise<PluginRecord> {
  const registry = await readRegistry();
  const plugin = registry.plugins.find((p) => p.name === pluginName);
  if (!plugin) throw new Error(`Plugin "${pluginName}" is not installed`);

  const manifest = await readManifest(plugin.path);

  // Remove settings for agents no longer in the manifest
  const removedAgents = plugin.agentNames.filter((n) => !manifest.agents.includes(n));
  // Unlink skills no longer in the manifest
  const removedSkills = plugin.skillNames.filter((s) => !manifest.skills.includes(s));

  await Promise.all([
    ...removedAgents.map(async (agentName) => {
      const dir = agentConfigDir(agentName);
      if (existsSync(dir)) await rm(dir, { recursive: true });
    }),
    unlinkPluginSkills(removedSkills, plugin.skillTargets),
  ]);

  // Upsert settings for current agents and ensure all current skills are linked
  await Promise.all([
    ...manifest.agents.map((agentName) => upsertAgentSettings(agentName, plugin.path)),
    linkPluginSkills(plugin.path, manifest.skills, plugin.skillTargets),
  ]);

  const updated: PluginRecord = {
    ...plugin,
    version: manifest.version,
    agentNames: manifest.agents,
    skillNames: manifest.skills,
  };
  const idx = registry.plugins.indexOf(plugin);
  registry.plugins[idx] = updated;
  await writeRegistry(registry);
  return updated;
}

/**
 * Update the skill symlink target directories for an installed plugin.
 * Unlinks skills from removed targets, links skills into the new targets, and persists to plugins.json.
 */
export async function updatePluginSkillTargets(
  pluginName: string,
  skillTargets: string[],
): Promise<PluginRecord> {
  const registry = await readRegistry();
  const plugin = registry.plugins.find((p) => p.name === pluginName);
  if (!plugin) throw new Error(`Plugin "${pluginName}" is not installed`);

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of skillTargets) {
    const target = normalizeSkillTargetPath(raw);
    if (!target) continue;
    if (!target.startsWith("~/") && !isAbsolute(target)) {
      throw new Error(`Invalid skill target path "${raw}": must start with ~/ or be absolute`);
    }
    if (!seen.has(target)) {
      seen.add(target);
      normalized.push(target);
    }
  }

  const prevTargets = resolvePluginSkillTargets(plugin);
  const removedTargets = prevTargets.filter((t) => !seen.has(t));

  if (removedTargets.length > 0) {
    await unlinkPluginSkills(plugin.skillNames, removedTargets);
  }
  await linkPluginSkills(plugin.path, plugin.skillNames, normalized);

  const updated: PluginRecord = {
    ...plugin,
    skillTargets: normalized,
  };
  const idx = registry.plugins.indexOf(plugin);
  registry.plugins[idx] = updated;
  await writeRegistry(registry);
  return updated;
}

/**
 * Pull latest changes for a git-installed plugin, then sync its agent settings.
 */
export async function updatePlugin(pluginName: string): Promise<PluginRecord> {
  const registry = await readRegistry();
  const plugin = registry.plugins.find((p) => p.name === pluginName);
  if (!plugin) throw new Error(`Plugin "${pluginName}" is not installed`);
  if (!plugin.gitUrl) throw new Error(`Plugin "${pluginName}" was not installed from a git URL`);

  await execAsync(`git -C ${plugin.path} fetch origin`);
  await execAsync(`git -C ${plugin.path} reset --hard origin/main`);
  await execAsync(`npm install --prefix ${plugin.path}`);
  await linkAgentSdkToPlugin(plugin.path);
  return syncPlugin(pluginName);
}
