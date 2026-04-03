import type { LucideIcon } from "lucide-react";
import { Brain, Bot, Zap, Radar, FlaskConical, BellRing, LifeBuoy, GitMerge } from "lucide-react";
import type { AgentConfigEntry } from "./agents-config-schemas";

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
  /** Human-readable schedule string for UI display */
  scheduleDisplay: string;
  /** launchd schedule */
  schedule?:
    | { type: "interval"; seconds: number }
    | { type: "calendar"; hour: number; minute: number; weekday?: number };
  /** Icon component for UI display */
  icon: LucideIcon;
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
}

// ─── Icon registry ─────────────────────────────────────────────────────────────
// Maps agent name → primary LucideIcon. New agents not in this map get Bot as default.

const AGENT_ICON_MAP: Record<string, LucideIcon> = {
  "memory-dream": Brain,
  "get-shit-done": Zap,
  "release-log-sentinel": Radar,
  "memory-distiller": FlaskConical,
  "oncall-analyzer": BellRing,
  "zendesk-triager": LifeBuoy,
  "dependabot-merger": GitMerge,
};

// Maps agent name → default iconBg + iconColor used when a suggestion doesn't specify them.
const AGENT_ICON_STYLE_MAP: Record<string, { iconBg: string; iconColor: string }> = {
  "memory-dream": {
    iconBg: "bg-accent group-hover:bg-primary",
    iconColor: "text-accent-foreground group-hover:text-primary-foreground",
  },
  "get-shit-done": {
    iconBg: "bg-yellow-100 group-hover:bg-primary",
    iconColor: "text-yellow-700 group-hover:text-primary-foreground",
  },
  "release-log-sentinel": {
    iconBg: "bg-blue-100 group-hover:bg-primary",
    iconColor: "text-blue-700 group-hover:text-primary-foreground",
  },
  "memory-distiller": {
    iconBg: "bg-purple-100 group-hover:bg-primary",
    iconColor: "text-purple-700 group-hover:text-primary-foreground",
  },
  "oncall-analyzer": {
    iconBg: "bg-red-100 group-hover:bg-primary",
    iconColor: "text-red-600 group-hover:text-primary-foreground",
  },
  "zendesk-triager": {
    iconBg: "bg-blue-100 group-hover:bg-primary",
    iconColor: "text-blue-700 group-hover:text-primary-foreground",
  },
  "dependabot-merger": {
    iconBg: "bg-green-100 group-hover:bg-primary",
    iconColor: "text-green-700 group-hover:text-primary-foreground",
  },
};

const DEFAULT_ICON_STYLE = {
  iconBg: "bg-accent group-hover:bg-primary",
  iconColor: "text-accent-foreground group-hover:text-primary-foreground",
};

/** Build a full AgentDef (including icon and derived fields) from a serializable config entry. */
export function buildAgentDef(entry: AgentConfigEntry): AgentDef {
  const manifestKey = entry.name.replaceAll("-", "_");
  const icon = AGENT_ICON_MAP[entry.name] ?? Bot;
  const style = AGENT_ICON_STYLE_MAP[entry.name] ?? DEFAULT_ICON_STYLE;

  const doveCard: AgentSuggestion = {
    icon,
    ...style,
    title: entry.doveCard.title,
    description: entry.doveCard.description,
    prompt: entry.doveCard.prompt,
  };

  const suggestions: AgentSuggestion[] = entry.suggestions.map((s) => ({
    icon,
    ...style,
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
    scheduleDisplay: entry.scheduleDisplay,
    schedule: entry.schedule,
    icon,
    doveCard,
    suggestions,
    runAtLoad: entry.runAtLoad,
    envVars: entry.envVars,
    schedulingEnabled: entry.schedulingEnabled ?? true,
  };
}
