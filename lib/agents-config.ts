import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  readdir,
  rm,
  access,
  constants,
  lstat,
  readlink,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { agentFileSchema, type AgentConfigEntry, type AgentFile } from "./agents-config-schemas";
import { buildAgentDef } from "./agents";
import {
  AGENT_SETTINGS_DIR,
  DOVEPAW_TMP_DIR,
  agentDefinitionFile,
  tmpAgentDefinitionFile,
} from "./paths";
import { pushConfig } from "./s3-config-sync";
import type { AgentDef } from "./agents";
import { readAgentLinksFile, writeAgentLinksFile } from "./agent-links";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * If `filePath` is a symlink into a plugin's agents/ directory, derive the
 * plugin root from the target path. Returns undefined for non-symlink files.
 * Target layout: {pluginDir}/agents/{agentName}/agent.json
 */
async function pluginPathFromSymlink(filePath: string): Promise<string | undefined> {
  try {
    const stat = await lstat(filePath);
    if (!stat.isSymbolicLink()) return undefined;
    const target = await readlink(filePath); // absolute path (we always symlink with absolute)
    return dirname(dirname(dirname(target))); // strip agent.json / agentName / agents
  } catch {
    return undefined;
  }
}

async function tryParseFile(file: string): Promise<AgentFile | null> {
  if (!(await fileExists(file))) return null;
  try {
    const result = agentFileSchema.safeParse(JSON.parse(await readFile(file, "utf-8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read a single agent's combined definition+settings file.
 * Checks settings.agents/ first; falls back to tmp/ for session agents.
 * Returns null when the file is absent or corrupt (after bak recovery attempt).
 */
export async function readAgentFile(agentName: string): Promise<AgentFile | null> {
  const file = agentDefinitionFile(agentName);
  const bak = `${file}.bak`;

  // For plugin-backed agents the file is a symlink; derive pluginPath from the
  // target rather than relying on a stored value (avoids machine-specific paths
  // being committed to the plugin repo).
  const pluginPath = await pluginPathFromSymlink(file);

  const primary = await tryParseFile(file);
  if (primary !== null) return pluginPath ? { ...primary, pluginPath } : primary;

  const backup = await tryParseFile(bak);
  if (backup !== null) {
    await copyFile(bak, file);
    return pluginPath ? { ...backup, pluginPath } : backup;
  }
  // Fall back to tmp/ for session agents created by Dove at runtime
  const tmpFile = tmpAgentDefinitionFile(agentName);
  return tryParseFile(tmpFile);
}

/** Scan all agent subdirectories and return their parsed agent.json files. */
async function readAllAgentFiles(): Promise<AgentFile[]> {
  if (!(await fileExists(AGENT_SETTINGS_DIR))) return [];
  try {
    const entries = await readdir(AGENT_SETTINGS_DIR, { withFileTypes: true });
    const results = await Promise.all(
      entries.filter((d) => d.isDirectory()).map((d) => readAgentFile(d.name)),
    );
    return results.filter((e): e is AgentFile => e !== null);
  } catch {
    return [];
  }
}

/**
 * Read agent config entries (definition fields only) from all agent dirs.
 * Returns [] when settings.agents/ is absent.
 */
export async function readAgentConfigEntries(): Promise<AgentConfigEntry[]> {
  const files = await readAllAgentFiles();
  return files.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ repos: _r, envVars: _e, version: _v, locked: _l, ...entry }) => entry,
  );
}

/**
 * Read both permanent and tmp agent configs, deduplicating by name.
 * Permanent entries are canonical; tmp entries with the same name are excluded
 * (prevents duplicate MCP tool registration and duplicate sidebar buttons).
 */
export async function readSplitAgentConfigEntries(): Promise<{
  entries: AgentConfigEntry[];
  tmpEntries: AgentConfigEntry[];
}> {
  const [entries, allTmpEntries] = await Promise.all([
    readAgentConfigEntries(),
    readTmpAgentConfigEntries(),
  ]);
  const tmpNames = new Set(allTmpEntries.map((e) => e.name));
  return { entries: entries.filter((e) => !tmpNames.has(e.name)), tmpEntries: allTmpEntries };
}

/** All agent config entries (permanent + tmp), deduplicated — tmp wins over permanent. */
export async function readAllAgentConfigEntries(): Promise<AgentConfigEntry[]> {
  const { entries, tmpEntries } = await readSplitAgentConfigEntries();
  return [...entries, ...tmpEntries];
}

/** Read agents config and hydrate each entry into a full AgentDef. Includes tmp/Kiln agents. */
export async function readAgentsConfig(): Promise<AgentDef[]> {
  const { entries, tmpEntries } = await readSplitAgentConfigEntries();
  return [
    ...entries.map(buildAgentDef),
    ...tmpEntries.map((e) =>
      Object.assign(buildAgentDef(e), {
        entryPath: join(DOVEPAW_TMP_DIR, e.name, e.scriptFile ?? "main.ts"),
      }),
    ),
  ];
}

/** Read only agents with schedulingEnabled !== false. */
export async function readScheduledAgentConfigEntries(): Promise<AgentConfigEntry[]> {
  return (await readAgentConfigEntries()).filter((a) => a.schedulingEnabled !== false);
}

/** Read only scheduling-enabled agents as full AgentDef[]. */
export async function readScheduledAgentsConfig(): Promise<AgentDef[]> {
  return (await readScheduledAgentConfigEntries()).map(buildAgentDef);
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Resolve the canonical file path for an agent — tmp/ takes precedence over settings.agents/.
 * Used so writes go back to the same location as reads.
 */
async function resolveAgentFilePath(agentName: string): Promise<string> {
  const tmpPath = tmpAgentDefinitionFile(agentName);
  if (await fileExists(tmpPath)) return tmpPath;
  return agentDefinitionFile(agentName);
}

/** Persist a combined agent file to its directory (with .bak). */
export async function writeAgentFile(agentName: string, file: AgentFile): Promise<void> {
  const dest = await resolveAgentFilePath(agentName);
  await mkdir(dirname(dest), { recursive: true });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pluginPath: _p, ...rest } = file;
  const data = JSON.stringify(rest, null, 2) + "\n";
  await writeFile(dest, data, "utf-8");
  await copyFile(dest, `${dest}.bak`);
  if (!dest.startsWith(DOVEPAW_TMP_DIR)) {
    await pushConfig(`settings.agents/${agentName}/agent.json`, data);
  }
}

/** Create a new agent file with empty repos/envVars. */
export async function createAgentFile(entry: AgentConfigEntry): Promise<void> {
  await writeAgentFile(entry.name, { version: 1, ...entry, repos: [], envVars: [], locked: false });
}

/**
 * Apply a partial patch to an agent file.
 * Only the specified fields are updated — all other fields are preserved.
 * If the file does not exist yet, a minimal skeleton is created first.
 */
export async function patchAgentFile(
  agentName: string,
  patch: Partial<AgentFile>,
): Promise<AgentFile> {
  const current: AgentFile = (await readAgentFile(agentName)) ?? {
    version: 1,
    name: agentName,
    alias: agentName.slice(0, 3),
    displayName: agentName,
    description: "",
    doveCard: { title: agentName, description: "", prompt: "" },
    suggestions: [],
    repos: [],
    envVars: [],
    locked: false,
  };
  const updated: AgentFile = {
    ...current,
    ...patch,
    version: 1,
    locked: patch.locked ?? current.locked,
  };
  await writeAgentFile(agentName, updated);
  return updated;
}

/** Update only the definition fields of an agent (everything except repos/envVars/locked).
 * envVars is omitted from defPatch because AgentConfigEntry.envVars (scheduler static vars) is
 * a different type to AgentFile.envVars (user-configured runtime vars). */
export async function patchAgentDefinition(
  agentName: string,
  defPatch: Partial<Omit<AgentConfigEntry, "envVars">>,
): Promise<void> {
  await patchAgentFile(agentName, defPatch);
}

// ─── Session (tmp) agents ─────────────────────────────────────────────────────

/** Scan ~/.dovepaw/tmp/ and return parsed AgentConfigEntry[] for session agents. Returns [] when absent. */
export async function readTmpAgentConfigEntries(): Promise<AgentConfigEntry[]> {
  if (!(await fileExists(DOVEPAW_TMP_DIR))) return [];
  try {
    const entries = await readdir(DOVEPAW_TMP_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((d) => d.isDirectory())
        .map((d) => tryParseFile(tmpAgentDefinitionFile(d.name))),
    );
    return (
      files
        .filter((f): f is AgentFile => f !== null)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ repos: _r, envVars: _e, version: _v, locked: _l, ...entry }) => entry)
    );
  } catch {
    return [];
  }
}

// ─── Grouping (re-exported from client-safe lib/agent-groups.ts) ─────────────
export { groupAgentsByPlugin, type AgentGroup } from "./agent-groups";

// ─── Delete ───────────────────────────────────────────────────────────────────

/** Delete the agent's entire directory (settings.agents/ or tmp/ for session agents). */
export async function deleteAgentDefinition(agentName: string): Promise<void> {
  const settingsDir = join(AGENT_SETTINGS_DIR, agentName);
  if (await fileExists(settingsDir)) {
    await rm(settingsDir, { recursive: true });
  } else {
    const tmpDir = join(DOVEPAW_TMP_DIR, agentName);
    if (await fileExists(tmpDir)) await rm(tmpDir, { recursive: true });
  }

  const file = await readAgentLinksFile();
  const links = file.links.filter((l) => l.source !== agentName && l.target !== agentName);
  const groups = file.groups.map((g) => ({
    ...g,
    members: g.members.filter((m) => m !== agentName),
  }));
  await writeAgentLinksFile({ ...file, links, groups });
}
