/** Zod schemas for per-agent definition files. No Node.js imports — safe in client components. */
import { z } from "zod";
import { envVarSchema, agentNotificationConfigSchema } from "./settings-schemas";

// ─── Schedule ─────────────────────────────────────────────────────────────────

export const agentIntervalScheduleSchema = z.object({
  type: z.literal("interval"),
  seconds: z.number().int().positive(),
});

export const agentCalendarScheduleSchema = z.object({
  type: z.literal("calendar"),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
  /** ISO weekday: 1 = Monday … 7 = Sunday */
  weekday: z.number().int().min(1).max(7).optional(),
});

export const agentOnetimeScheduleSchema = z.object({
  type: z.literal("onetime"),
  /** Stored for display only — scheduler has no Year key in interval specs */
  year: z.number().int().min(2024),
  month: z.number().int().min(1).max(12),
  day: z.number().int().min(1).max(31),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

export type AgentOnetimeSchedule = z.infer<typeof agentOnetimeScheduleSchema>;

export const agentScheduleSchema = z.discriminatedUnion("type", [
  agentIntervalScheduleSchema,
  agentCalendarScheduleSchema,
  agentOnetimeScheduleSchema,
]);

export type AgentSchedule = z.infer<typeof agentScheduleSchema>;

// ─── Schedule display ──────────────────────────────────────────────────────────

const ISO_WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Derive a human-readable schedule string from the schedule object. No stored field needed. */
export function formatScheduleDisplay(schedule: AgentSchedule | undefined): string {
  if (!schedule) return "on demand";
  if (schedule.type === "interval") {
    const { seconds } = schedule;
    if (seconds % 3600 === 0) return `every ${seconds / 3600}h`;
    if (seconds % 60 === 0) return `every ${seconds / 60}m`;
    return `every ${seconds}s`;
  }
  const hh = String(schedule.hour).padStart(2, "0");
  const mm = String(schedule.minute).padStart(2, "0");
  const time = `${hh}:${mm}`;
  if (schedule.type === "onetime") {
    const d = `${schedule.year}-${String(schedule.month).padStart(2, "0")}-${String(schedule.day).padStart(2, "0")}`;
    return `Once ${d} ${time}`;
  }
  if (schedule.weekday !== undefined) {
    return `${ISO_WEEKDAY_NAMES[schedule.weekday - 1]} ${time}`;
  }
  return `Daily ${time}`;
}

// ─── Scheduled job ────────────────────────────────────────────────────────────

export const scheduledJobSchema = z.object({
  /** 8-char hex ID, unique per agent — used as scheduler config filename suffix */
  id: z.string().min(1),
  /** Short label describing what this job does — shown in the UI and config */
  label: z.string().default(""),
  schedule: agentScheduleSchema.optional(),
  instruction: z.string().default(""),
  runAtLoad: z.boolean().optional(),
});

export type ScheduledJob = z.infer<typeof scheduledJobSchema>;

export function formatJobsDisplay(jobs: ScheduledJob[]): string {
  if (jobs.length === 0) return "on demand";
  if (jobs.length === 1) return formatScheduleDisplay(jobs[0].schedule);
  return `${jobs.length} jobs`;
}

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
  /** Agent schedule — absent means on-demand */
  schedule: agentScheduleSchema.optional(),
  /** Whether to run immediately when the scheduler activates this agent */
  runAtLoad: z.boolean().optional(),
  /** Env vars to embed in the scheduler config and seed into user settings on fresh install.
   *  Uses a simplified shape (no id) — id is assigned by makeEnvVar at install time. */
  envVars: z
    .array(z.object({ key: z.string(), value: z.string(), isSecret: z.boolean().default(false) }))
    .optional(),
  /** Default repo IDs to seed into settings.agents on fresh install */
  repos: z.array(z.string()).optional(),
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
  /** Personality paragraph injected at the top of the sub-agent system prompt.
   *  Replaces the generic "You are one of Dove's mice…" line. Keep it 1–3 sentences. */
  personality: z.string().optional(),
  /** Multiple scheduled jobs — each gets its own scheduler config entry. Replaces top-level schedule/runAtLoad. */
  scheduledJobs: z.array(scheduledJobSchema).optional(),
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
    /** Optional notification config for SessionStart / SessionEnd events. */
    notifications: agentNotificationConfigSchema.optional(),
  })
  .extend({
    // Allow empty strings at rest — validated at save time via agentConfigEntrySchema
    alias: z.string(),
    displayName: z.string(),
    description: z.string(),
  });

export type AgentFile = z.infer<typeof agentFileSchema>;
