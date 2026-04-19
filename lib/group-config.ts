/**
 * Server-side read/write for per-group configuration.
 * Stored in ~/.dovepaw/settings.groups/<groupName>/group.json.
 *
 * Do NOT import this file in client components — it uses node:fs.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { groupConfigDir, groupConfigFile } from "./paths";
import { groupConfigSchema, type GroupConfig } from "./group-config-schemas";

function defaultGroupConfig(name: string): GroupConfig {
  return { version: 1, name, repos: [], envVars: [] };
}

/** Read and validate the group config; returns null if missing or unparseable. */
export function readGroupConfig(groupName: string): GroupConfig | null {
  const file = groupConfigFile(groupName);
  if (!existsSync(file)) return null;
  try {
    const result = groupConfigSchema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Read group config, seeding defaults if the file is absent. */
export function readOrCreateGroupConfig(groupName: string): GroupConfig {
  return readGroupConfig(groupName) ?? defaultGroupConfig(groupName);
}

/** Write group config to disk with a .bak safety copy. */
export function writeGroupConfig(groupName: string, config: GroupConfig): void {
  const dir = groupConfigDir(groupName);
  mkdirSync(dir, { recursive: true });
  const file = groupConfigFile(groupName);
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf-8");
  copyFileSync(file, `${file}.bak`);
}

/** Partially update a group config, preserving all other fields. */
export function patchGroupConfig(
  groupName: string,
  patch: Partial<Omit<GroupConfig, "version" | "name">>,
): void {
  const existing = readOrCreateGroupConfig(groupName);
  writeGroupConfig(groupName, { ...existing, ...patch });
}
