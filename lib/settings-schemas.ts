/** Zod schemas and derived types for settings. No Node.js imports — safe in client components. */
import { z } from "zod";

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
