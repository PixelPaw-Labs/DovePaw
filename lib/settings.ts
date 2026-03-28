import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { z } from "zod";
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

function hasAgentContent(s: AgentSettings): boolean {
  return s.repos.length > 0 || s.envVars.length > 0;
}

// ─── Global Read / Write ──────────────────────────────────────────────────────

function restoreFromBak(bak: string, dest: string): void {
  if (existsSync(bak)) copyFileSync(bak, dest);
}

export function readSettings(): GlobalSettings {
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

export function writeSettings(settings: GlobalSettings): void {
  mkdirSync(DOVEPAW_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  copyFileSync(SETTINGS_FILE, `${SETTINGS_FILE}.bak`);
}

// ─── Per-Agent Read / Write ───────────────────────────────────────────────────

export function readAgentSettings(agentName: string): AgentSettings {
  const file = agentSettingsFile(agentName);
  const bak = `${file}.bak`;
  const primary = tryParse(agentSettingsSchema, file);

  if (!primary) {
    const backup = tryParse(agentSettingsSchema, bak);
    if (backup) restoreFromBak(bak, file);
    return backup ?? defaultAgentSettings();
  }
  if (!hasAgentContent(primary)) {
    const backup = tryParse(agentSettingsSchema, bak);
    if (backup && hasAgentContent(backup)) {
      restoreFromBak(bak, file);
      return backup;
    }
  }
  return primary;
}

export function writeAgentSettings(agentName: string, settings: AgentSettings): void {
  mkdirSync(AGENT_SETTINGS_DIR, { recursive: true });
  const file = agentSettingsFile(agentName);
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n", "utf-8");
  copyFileSync(file, `${file}.bak`);
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
