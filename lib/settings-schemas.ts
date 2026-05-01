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

export const DOVE_MODES = ["read-only", "supervised", "autonomous"] as const;
export type DoveMode = (typeof DOVE_MODES)[number];

export const doveSettingsSchema = z.object({
  /** Human-readable name shown in UI and system prompt. Defaults to "Dove". */
  displayName: z.string().default("Dove"),
  /** Landing page greeting title. Defaults to the hardcoded string when empty. */
  landingTitle: z.string().default(""),
  /** Landing page description. Defaults to the age-computed string when empty. */
  landingDescription: z.string().default(""),
  /** One-line tagline after the display name in the system prompt. Supports {agentCount}. Uses the built-in line when empty. */
  tagline: z.string().default(""),
  /** Personality paragraph appended to the system prompt. Uses the built-in cat persona when empty. */
  persona: z.string().default(""),
  /** URL or path to the avatar image served from public/. Defaults to "/dove-avatar.webp". */
  avatarUrl: z.string().default("/dove-avatar.webp"),
  /** Lucide icon name used as fallback when no photo avatar is set. */
  iconName: z.string().default("Bot"),
  /** Tailwind bg classes for the icon circle. */
  iconBg: z.string().default("bg-purple-100"),
  /** Tailwind text color classes for the icon. */
  iconColor: z.string().default("text-purple-700"),
  /**
   * Default Claude model for both Dove and sub-agent SDK queries.
   * Accepts aliases ("sonnet", "opus", "haiku") or full IDs ("claude-sonnet-4-6").
   * Empty string (default) defers to the SDK's built-in default.
   */
  defaultModel: z.string().default(""),
  /** Controls what Dove itself can do. Sub-agents always run autonomously. */
  doveMode: z.enum(DOVE_MODES).default("supervised"),
  /** Allow Dove to use WebFetch and WebSearch tools. */
  allowWebTools: z.boolean().default(false),
});

export type DoveSettings = z.infer<typeof doveSettingsSchema>;

/** Returns effective Dove settings, filling in all defaults. Safe to call with undefined. */
export function effectiveDoveSettings(s: { dove?: unknown }): DoveSettings {
  return doveSettingsSchema.parse(s.dove ?? {});
}

export const globalSettingsSchema = z.object({
  version: z.literal(1),
  repositories: z.array(repositorySchema),
  envVars: z.array(envVarSchema).default([]),
  dove: doveSettingsSchema.optional(),
});

export type Repository = z.infer<typeof repositorySchema>;
export type EnvVar = z.infer<typeof envVarSchema>;
export type GlobalSettings = z.infer<typeof globalSettingsSchema>;

// ─── Per-Agent Notifications Schema ───────────────────────────────────────────

const ntfyChannelSchema = z.object({
  type: z.literal("ntfy"),
  topic: z.string().min(1),
  server: z.string().url().default("https://ntfy.sh"),
});

export const notificationChannelSchema = z.discriminatedUnion("type", [ntfyChannelSchema]);

export const agentNotificationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  onSessionStart: z.boolean().default(false),
  onSessionEnd: z.boolean().default(true),
  channel: notificationChannelSchema,
});

export type AgentNotificationConfig = z.infer<typeof agentNotificationConfigSchema>;

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
  /** Optional notification config for SessionStart / SessionEnd events. */
  notifications: agentNotificationConfigSchema.optional(),
});

export type AgentSettings = z.infer<typeof agentSettingsSchema>;
