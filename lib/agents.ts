import type { LucideIcon } from "lucide-react";
import type { AgentConfigEntry, AgentSchedule, ScheduledJob } from "./agents-config-schemas";
import { resolveIcon, DEFAULT_ICON_STYLE } from "./icon-registry";

const TOOL_PREFIX = "yolo";

export interface AgentSuggestion {
  icon: LucideIcon;
  /** Tailwind classes for the icon background circle */
  iconBg: string;
  /** Tailwind classes for the icon itself */
  iconColor: string;
  title: string;
  description: string;
  prompt: string;
}

export interface AgentDef {
  /** kebab-case identifier — used for file names, plist label suffix, log dirs */
  name: string;
  /** Short alias used as workspace directory prefix (e.g. "gsd", "zt") */
  alias: string;
  /** Source entry point relative to agents/ root */
  entryPath: string;
  /** Human-readable display name */
  displayName: string;
  /** launchd service label — derived: "Claude Code Agent - <displayName>" */
  label: string;
  /** Underscore key used in .ports.json manifest — derived: name with - → _ */
  manifestKey: string;
  /** MCP tool name exposed to Claude — derived: <TOOL_PREFIX>_<manifestKey> */
  toolName: string;
  /** Short description for MCP tool and system prompt */
  description: string;
  /** launchd schedule */
  schedule?: AgentSchedule;
  /** Icon component for UI display */
  icon: LucideIcon;
  /** Tailwind classes for the agent icon background */
  iconBg: string;
  /** Tailwind classes for the agent icon color */
  iconColor: string;
  /** Card shown on the Dove intro suggestion grid */
  doveCard: AgentSuggestion;
  /** Starter suggestion cards shown on the agent's empty chat screen */
  suggestions: AgentSuggestion[];
  /** Whether to run immediately when loaded */
  runAtLoad?: boolean;
  /** Extra static env vars to embed in the launchd plist */
  envVars?: Record<string, string>;
  /** When false, hidden from Scheduled Agents Management and A2A servers. Defaults to true. */
  schedulingEnabled?: boolean;
  /** Absolute path to the plugin repo root. Absent = agent lives in DovePaw/agents/. */
  pluginPath?: string;
  /** Personality paragraph injected at the top of the sub-agent system prompt.
   *  Replaces the generic "You are one of Dove's mice…" line. */
  personality?: string;
  /** Multiple scheduled jobs — each gets its own launchd plist. */
  scheduledJobs?: ScheduledJob[];
}

/** Build a full AgentDef (including icon and derived fields) from a serializable config entry. */
export function buildAgentDef(entry: AgentConfigEntry): AgentDef {
  const manifestKey = entry.name.replaceAll("-", "_");
  const icon = resolveIcon(entry.iconName);
  const iconBg = entry.iconBg ?? DEFAULT_ICON_STYLE.iconBg;
  const iconColor = entry.iconColor ?? DEFAULT_ICON_STYLE.iconColor;

  const suggestionStyle = { iconBg, iconColor };

  const doveCard: AgentSuggestion = {
    icon,
    ...suggestionStyle,
    title: entry.doveCard.title,
    description: entry.doveCard.description,
    prompt: entry.doveCard.prompt,
  };

  const suggestions: AgentSuggestion[] = entry.suggestions.map((s) => ({
    icon: resolveIcon(s.iconName ?? entry.iconName),
    ...suggestionStyle,
    title: s.title,
    description: s.description,
    prompt: s.prompt,
  }));

  return {
    name: entry.name,
    alias: entry.alias,
    entryPath: `agents/${entry.name}/main.ts`,
    displayName: entry.displayName,
    label: `Claude Code Agent - ${entry.displayName}`,
    manifestKey,
    toolName: `${TOOL_PREFIX}_${manifestKey}`,
    description: entry.description,
    schedule: entry.schedule,
    icon,
    iconBg,
    iconColor,
    doveCard,
    suggestions,
    runAtLoad: entry.runAtLoad,
    envVars: entry.envVars
      ? Object.fromEntries(entry.envVars.map(({ key, value }) => [key, value]))
      : undefined,
    schedulingEnabled: entry.schedulingEnabled ?? true,
    pluginPath: entry.pluginPath,
    personality: entry.personality,
    scheduledJobs: entry.scheduledJobs,
  };
}
