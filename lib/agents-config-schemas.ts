/** Zod schemas for per-agent definition files. No Node.js imports — safe in client components. */
import { z } from "zod";
import { envVarSchema } from "./settings-schemas";

// ─── Schedule ─────────────────────────────────────────────────────────────────

export const agentIntervalScheduleSchema = z.object({
  type: z.literal("interval"),
  seconds: z.number().int().positive(),
});

export const agentCalendarScheduleSchema = z.object({
  type: z.literal("calendar"),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  weekday: z.number().int().min(0).max(6).optional(),
});

export const agentScheduleSchema = z.discriminatedUnion("type", [
  agentIntervalScheduleSchema,
  agentCalendarScheduleSchema,
]);

export type AgentSchedule = z.infer<typeof agentScheduleSchema>;

// ─── Suggestion (serializable — no LucideIcon) ───────────────────────────────

export const agentSuggestionConfigSchema = z.object({
  title: z.string(),
  description: z.string(),
  prompt: z.string(),
  /** Icon name from LUCIDE_ICON_REGISTRY. Inherits from the agent if absent. */
  iconName: z.string().optional(),
});

export type AgentSuggestionConfig = z.infer<typeof agentSuggestionConfigSchema>;

// ─── Single Agent Entry ───────────────────────────────────────────────────────

export const agentConfigEntrySchema = z.object({
  /** kebab-case identifier — must be unique, used as key in all downstream systems */
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "Must be kebab-case"),
  /** Short alias used as workspace directory prefix (e.g. "gsd") */
  alias: z.string().min(1),
  /** Human-readable display name */
  displayName: z.string().min(1),
  /** Short description for MCP tool and system prompt */
  description: z.string().min(1),
  /** Human-readable schedule string for UI display (e.g. "daily 00:00", "every 5 min") */
  scheduleDisplay: z.string(),
  /** launchd schedule — absent means on-demand */
  schedule: agentScheduleSchema.optional(),
  /** Whether to run immediately when launchd loads the plist */
  runAtLoad: z.boolean().optional(),
  /** Extra static env vars to embed in the launchd plist */
  envVars: z.record(z.string(), z.string()).optional(),
  /** When false, hidden from Scheduled Agents Management and A2A servers. Absent = true. */
  schedulingEnabled: z.boolean().optional(),
  /** Icon name from LUCIDE_ICON_REGISTRY (e.g. "Brain", "Zap"). Defaults to "Bot" if absent. */
  iconName: z.string().optional(),
  /** Tailwind classes for the icon background circle (e.g. "bg-yellow-100 group-hover:bg-primary"). */
  iconBg: z.string().optional(),
  /** Tailwind classes for the icon color (e.g. "text-yellow-700 group-hover:text-primary-foreground"). */
  iconColor: z.string().optional(),
  /** Card shown on the Dove intro suggestion grid */
  doveCard: agentSuggestionConfigSchema,
  /** Starter suggestion cards shown on the agent's empty chat screen */
  suggestions: z.array(agentSuggestionConfigSchema),
  /** Absolute path to the plugin repo root. Absent = agent lives in DovePaw/agents/. */
  pluginPath: z.string().optional(),
});

export type AgentConfigEntry = z.infer<typeof agentConfigEntrySchema>;

// ─── Top-level config file schema ─────────────────────────────────────────────

export const agentsConfigSchema = z.object({
  version: z.literal(1),
  agents: z.array(agentConfigEntrySchema),
});

export type AgentsConfig = z.infer<typeof agentsConfigSchema>;

// ─── Combined per-agent file (definition + runtime settings) ─────────────────

/**
 * The shape of ~/.dovepaw/settings.agents/<name>/agent.json.
 * Merges the full agent definition with per-agent runtime settings (repos + envVars).
 * String fields are intentionally permissive (no min(1)) so skeletal files
 * (created before the definition is fully filled in) still parse correctly.
 * UI save paths use agentConfigEntrySchema to enforce completeness.
 */
export const agentFileSchema = agentConfigEntrySchema
  .extend({
    version: z.literal(1),
    repos: z.array(z.string()).default([]),
    envVars: z.array(envVarSchema).default([]),
    /** When true, the agent cannot be deleted via the UI or API until unlocked. */
    locked: z.boolean().optional().default(false),
  })
  .extend({
    // Allow empty strings at rest — validated at save time via agentConfigEntrySchema
    alias: z.string(),
    displayName: z.string(),
    description: z.string(),
    scheduleDisplay: z.string(),
  });

export type AgentFile = z.infer<typeof agentFileSchema>;
