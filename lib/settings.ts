import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { DOVEPAW_DIR, SETTINGS_FILE, AGENT_SETTINGS_DIR, agentSettingsFile } from "./paths";

// ─── Global Schema ─────────────────────────────────────────────────────────────

export const repositorySchema = z.object({
  id: z.string(),
  name: z.string(),
  githubRepo: z.string(),
});

export const envVarSchema = z.object({
  id: z.string(),
  key: z.string(),
  /** Plain-text value for non-secret vars. Empty string for secrets (value lives in OS keychain). */
  value: z.string(),
  isSecret: z.boolean().default(false),
  /**
   * When set, this secret is a read-only link to an existing keychain entry owned by another app.
   * Dovepaw will never write or delete it.
   * When absent, the secret is dovepaw-managed (service="dovepaw", account=key).
   */
  keychainService: z.string().optional(),
  keychainAccount: z.string().optional(),
});

export const globalSettingsSchema = z.object({
  version: z.literal(1),
  repositories: z.array(repositorySchema),
  envVars: z.array(envVarSchema).default([]),
});

export type Repository = z.infer<typeof repositorySchema>;
export type EnvVar = z.infer<typeof envVarSchema>;
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;

// ─── Per-Agent Schema ──────────────────────────────────────────────────────────

export const agentSettingsSchema = z.object({
  /** Repository IDs enabled for this agent. Empty = none enabled. */
  repos: z.array(z.string()).default([]),
  /**
   * Per-agent environment variable overrides.
   * These take precedence over global envVars when the agent runs.
   * If a key is absent here, the global value is inherited automatically.
   */
  envVars: z.array(envVarSchema).default([]),
});

export type AgentSettings = z.infer<typeof agentSettingsSchema>;

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
  writeFileSync(agentSettingsFile(agentName), JSON.stringify(settings, null, 2) + "\n", "utf-8");
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
