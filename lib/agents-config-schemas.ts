/** Zod schemas for ~/.dovepaw/agents.json. No Node.js imports — safe in client components. */
import { z } from "zod";

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
  /** Card shown on the Dove intro suggestion grid */
  doveCard: agentSuggestionConfigSchema,
  /** Starter suggestion cards shown on the agent's empty chat screen */
  suggestions: z.array(agentSuggestionConfigSchema),
});

export type AgentConfigEntry = z.infer<typeof agentConfigEntrySchema>;

// ─── Top-level config file schema ─────────────────────────────────────────────

export const agentsConfigSchema = z.object({
  version: z.literal(1),
  agents: z.array(agentConfigEntrySchema),
});

export type AgentsConfig = z.infer<typeof agentsConfigSchema>;
