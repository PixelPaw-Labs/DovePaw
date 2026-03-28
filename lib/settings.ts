import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { DOVEPAW_DIR, SETTINGS_FILE, AGENT_SETTINGS_DIR, agentSettingsFile } from "./paths";
import {
  globalSettingsSchema,
  agentSettingsSchema,
  type GlobalSettings,
  type AgentSettings,
  type Repository,
  type EnvVar,
} from "./settings-schemas";

// ─── Defaults ─────────────────────────────────────────────────────────────────

export function defaultSettings(): GlobalSettings {
  return { version: 1, repositories: [], envVars: [] };
}

export function defaultAgentSettings(): AgentSettings {
  return { repos: [], envVars: [] };
}

// ─── Global Read / Write ──────────────────────────────────────────────────────

export function readSettings(): GlobalSettings {
  if (!existsSync(SETTINGS_FILE)) return defaultSettings();
  try {
    const parsed = globalSettingsSchema.safeParse(JSON.parse(readFileSync(SETTINGS_FILE, "utf-8")));
    return parsed.success ? parsed.data : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function writeSettings(settings: GlobalSettings): void {
  mkdirSync(DOVEPAW_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.bak`);
}

// ─── Per-Agent Read / Write ───────────────────────────────────────────────────

export function readAgentSettings(agentName: string): AgentSettings {
  const file = agentSettingsFile(agentName);
  if (!existsSync(file)) return defaultAgentSettings();
  try {
    const parsed = agentSettingsSchema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
    return parsed.success ? parsed.data : defaultAgentSettings();
  } catch {
    return defaultAgentSettings();
  }
}

export function writeAgentSettings(agentName: string, settings: AgentSettings): void {
  mkdirSync(AGENT_SETTINGS_DIR, { recursive: true });
  const file = agentSettingsFile(agentName);
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  copyFileSync(file, `${file}.bak`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
