/**
 * Plugin manager — single source of truth for all plugin operations.
 * Called from both the CLI (scripts/plugin.ts) and chatbot API routes.
 */

import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { agentConfigEntrySchema } from "./agents-config-schemas";
import { readAgentFile, writeAgentFile } from "./agents-config";
import { PLUGINS_DIR, PLUGINS_REGISTRY_FILE, agentConfigDir } from "./paths";
import { makeEnvVar } from "./settings";
import { linkAgentSdkToPlugin } from "./installer";
import {
  pluginManifestSchema,
  pluginRecordSchema,
  pluginsRegistrySchema,
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
  await writeFile(PLUGINS_REGISTRY_FILE, JSON.stringify(registry, null, 2) + "\n", "utf-8");
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

/** Upsert an agent's settings file from the plugin's agent.json, merging in pluginPath. */
async function upsertAgentSettings(agentName: string, pluginDir: string): Promise<void> {
  const agentJsonPath = join(pluginDir, "agents", agentName, "agent.json");
  let raw: string;
  try {
    raw = await readFile(agentJsonPath, "utf-8");
  } catch {
    throw new Error(`agents/${agentName}/agent.json not found in ${pluginDir}`);
  }

  const entry = agentConfigEntrySchema.parse(JSON.parse(raw));
  const existing = await readAgentFile(agentName);

  // On fresh install (no existing file), seed envVars from the plugin source's
  // static envVars (Record<string, string>). On update, always preserve the
  // user's runtime config unchanged.
  const seedEnvVars = Object.entries(entry.envVars ?? {}).map(([key, value]) =>
    makeEnvVar(key, value),
  );

  await writeAgentFile(agentName, {
    version: 1,
    ...entry,
    pluginPath: pluginDir,
    // Preserve any user-configured runtime settings; seed from plugin source on fresh install
    repos: existing?.repos ?? [],
    envVars: existing?.envVars ?? seedEnvVars,
    locked: existing?.locked ?? false,
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

  await linkAgentSdkToPlugin(pluginDir);

  await Promise.all(manifest.agents.map((agentName) => upsertAgentSettings(agentName, pluginDir)));

  const registry = await readRegistry();
  const now = new Date().toISOString();
  const existing = registry.plugins.find((p) => p.name === manifest.name);

  const record: PluginRecord = pluginRecordSchema.parse({
    name: manifest.name,
    path: pluginDir,
    gitUrl,
    installedAt: existing?.installedAt ?? now,
    agentNames: manifest.agents,
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

  await Promise.all(
    plugin.agentNames.map(async (agentName) => {
      const dir = agentConfigDir(agentName);
      if (existsSync(dir)) await rm(dir, { recursive: true });
    }),
  );

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
  const removed = plugin.agentNames.filter((n) => !manifest.agents.includes(n));
  await Promise.all(
    removed.map(async (agentName) => {
      const dir = agentConfigDir(agentName);
      if (existsSync(dir)) await rm(dir, { recursive: true });
    }),
  );

  // Upsert settings for current agents
  await Promise.all(
    manifest.agents.map((agentName) => upsertAgentSettings(agentName, plugin.path)),
  );

  const updated: PluginRecord = { ...plugin, agentNames: manifest.agents };
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

  await execAsync(`git -C ${plugin.path} pull --ff-only`);
  await linkAgentSdkToPlugin(plugin.path);
  return syncPlugin(pluginName);
}
