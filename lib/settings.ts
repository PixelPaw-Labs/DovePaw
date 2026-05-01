import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { z } from "zod";
import { DOVEPAW_DIR, SETTINGS_FILE } from "./paths";
import { pushConfig } from "./s3-config-sync";
import {
  globalSettingsSchema,
  type GlobalSettings,
  type AgentSettings,
  type Repository,
  type EnvVar,
} from "./settings-schemas";
import { readAgentFile, patchAgentFile } from "./agents-config";

// ─── Defaults ─────────────────────────────────────────────────────────────────

export function defaultSettings(): GlobalSettings {
  return { version: 1, repositories: [], envVars: [] };
}

export function defaultAgentSettings(): AgentSettings {
  return { repos: [], envVars: [] };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tryParse<T>(schema: z.ZodType<T>, file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    const result = schema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function hasContent(s: GlobalSettings): boolean {
  return s.repositories.length > 0 || s.envVars.length > 0;
}

// ─── Global Read / Write ──────────────────────────────────────────────────────

function restoreFromBak(bak: string, dest: string): void {
  if (existsSync(bak)) copyFileSync(bak, dest);
}

export async function readSettings(): Promise<GlobalSettings> {
  const primary = tryParse(globalSettingsSchema, SETTINGS_FILE);
  const bak = `${SETTINGS_FILE}.bak`;

  if (!primary) {
    const backup = tryParse(globalSettingsSchema, bak);
    if (backup) restoreFromBak(bak, SETTINGS_FILE);
    return backup ?? defaultSettings();
  }
  if (!hasContent(primary)) {
    const backup = tryParse(globalSettingsSchema, bak);
    if (backup && hasContent(backup)) {
      restoreFromBak(bak, SETTINGS_FILE);
      return backup;
    }
  }
  return primary;
}

export async function writeSettings(settings: GlobalSettings): Promise<void> {
  mkdirSync(DOVEPAW_DIR, { recursive: true });
  const body = JSON.stringify(settings, null, 2) + "\n";
  writeFileSync(SETTINGS_FILE, body, "utf-8");
  copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.bak`);
  await pushConfig("settings.json", body);
}

// ─── Per-Agent Read / Write ───────────────────────────────────────────────────

/**
 * Read per-agent runtime settings (repos + envVars) from the agent's definition file.
 * Returns defaults when the agent file is absent.
 */
export async function readAgentSettings(agentName: string): Promise<AgentSettings> {
  const file = await readAgentFile(agentName);
  return {
    repos: file?.repos ?? [],
    envVars: file?.envVars ?? [],
    notifications: file?.notifications,
  };
}

/**
 * Patch only the runtime settings (repos/envVars) of an agent's definition file.
 * All definition fields are preserved unchanged.
 */
export async function writeAgentSettings(
  agentName: string,
  settings: AgentSettings,
): Promise<void> {
  await patchAgentFile(agentName, settings);
}

// ─── Factory helpers ──────────────────────────────────────────────────────────

export function makeRepository(githubRepo: string): Repository {
  const trimmed = githubRepo.trim();
  const name = trimmed.split("/").at(-1) ?? trimmed;
  return { id: crypto.randomUUID(), name, githubRepo: trimmed };
}

export function makeEnvVar(
  key: string,
  value: string,
  isSecret = false,
  keychainService?: string,
  keychainAccount?: string,
): EnvVar {
  const trimmedKey = key.trim();
  return {
    id: crypto.randomUUID(),
    key: trimmedKey,
    value: isSecret ? "" : value,
    isSecret,
    ...(keychainService ? { keychainService, keychainAccount: keychainAccount ?? trimmedKey } : {}),
  };
}

/** True when dovepaw owns this keychain entry (created it, can update/delete it). */
export function isDovepawManaged(envVar: EnvVar): boolean {
  return envVar.isSecret && !envVar.keychainService;
}
