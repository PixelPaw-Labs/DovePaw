import type { LucideIcon } from "lucide-react";
import {
  Brain,
  Bot,
  Zap,
  Radar,
  FlaskConical,
  BellRing,
  LifeBuoy,
  GitMerge,
  Play,
  FileText,
  BookOpen,
  ListTodo,
  GitPullRequest,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Clock,
  Search,
  CheckCircle,
  Eye,
  Info,
  Hammer,
} from "lucide-react";
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
  /** When false, hidden from Scheduled Agents Management and A2A servers. Defaults to true. */
  schedulingEnabled?: boolean;
  /** Extra static env vars to embed in the launchd plist */
  envVars?: Record<string, string>;
}

type AgentInput = Omit<AgentDef, "entryPath" | "label" | "manifestKey" | "toolName">;

function defineAgent(input: AgentInput): AgentDef {
  const manifestKey = input.name.replaceAll("-", "_");
  return {
    ...input,
    entryPath: `agents/${input.name}/main.ts`,
    label: `Claude Code Agent - ${input.displayName}`,
    manifestKey,
    toolName: `${TOOL_PREFIX}_${manifestKey}`,
  };
}

export const AGENTS: AgentDef[] = [
  defineAgent({
    name: "memory-dream",
    alias: "mdr",
    displayName: "Memory Dream",
    description:
      "Dream and consolidate memories from past Claude Code sessions: fetches the last 24 hours of sessions " +
      "via the local session API, extracts domain knowledge and user preferences, and writes " +
      "learnings into project MEMORY.md files. " +
      "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
      "or when asked to 'learn from sessions', 'dream through memories', 'rewind and learn', or 'reflect on past Claude Code work'. " +
      "Requires PROJECTS env var.",

    icon: Brain,
    scheduleDisplay: "daily 00:00",
    schedule: { type: "calendar", hour: 0, minute: 0 },
    doveCard: {
      icon: Brain,
      iconBg: "bg-accent group-hover:bg-primary",
      iconColor: "text-accent-foreground group-hover:text-primary-foreground",
      title: "Memory Dream",
      description: "What does Memory Dream do?",
      prompt: "What does Memory Dream do?",
    },
    suggestions: [
      {
        icon: Brain,
        iconBg: "bg-accent group-hover:bg-primary",
        iconColor: "text-accent-foreground group-hover:text-primary-foreground",
        title: "What does it do?",
        description: "What does Memory Dream do?",
        prompt: "What does Memory Dream do?",
      },
      {
        icon: Play,
        iconBg: "bg-green-100 group-hover:bg-primary",
        iconColor: "text-green-700 group-hover:text-primary-foreground",
        title: "Run now",
        description: "Run Memory Dream now",
        prompt: "Run Memory Dream now",
      },
      {
        icon: BookOpen,
        iconBg: "bg-blue-100 group-hover:bg-primary",
        iconColor: "text-blue-700 group-hover:text-primary-foreground",
        title: "Recent learnings",
        description: "Show me recent learnings extracted",
        prompt: "Show me recent learnings extracted",
      },
      {
        icon: FileText,
        iconBg: "bg-slate-100 group-hover:bg-primary",
        iconColor: "text-slate-600 group-hover:text-primary-foreground",
        title: "Last run logs",
        description: "Show Memory Dream logs",
        prompt: "Show Memory Dream logs",
      },
      {
        icon: Info,
        iconBg: "bg-purple-100 group-hover:bg-primary",
        iconColor: "text-purple-700 group-hover:text-primary-foreground",
        title: "Current status",
        description: "What is Memory Dream currently doing?",
        prompt: "What is Memory Dream currently doing?",
      },
      {
        icon: TrendingUp,
        iconBg: "bg-orange-100 group-hover:bg-primary",
        iconColor: "text-orange-600 group-hover:text-primary-foreground",
        title: "Memory impact",
        description: "Which MEMORY.md files were updated last run?",
        prompt: "Which MEMORY.md files were updated last run?",
      },
    ],
  }),
  defineAgent({
    name: "get-shit-done",
    alias: "gsd",
    displayName: "Get Shit Done",
    description:
      "Automated JIRA ticket implementer: discovers Kanban tickets, forges implementations in " +
      "parallel git worktrees, and creates PRs. " +
      "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
      "or when asked to 'run GSD', 'process tickets', 'forge JIRA tickets', or 'start the pipeline'. " +
      "Requires REPO_LIST + JIRA_ASSIGNEE env vars.",

    icon: Zap,
    scheduleDisplay: "every 5 min",
    schedule: { type: "interval", seconds: 300 },
    doveCard: {
      icon: Zap,
      iconBg: "bg-yellow-100 group-hover:bg-primary",
      iconColor: "text-yellow-700 group-hover:text-primary-foreground",
      title: "Get Shit Done",
      description: "How does Get Shit Done work?",
      prompt: "How does Get Shit Done work?",
    },
    suggestions: [
      {
        icon: Zap,
        iconBg: "bg-yellow-100 group-hover:bg-primary",
        iconColor: "text-yellow-700 group-hover:text-primary-foreground",
        title: "Run now",
        description: "Run Get Shit Done now",
        prompt: "Run Get Shit Done now",
      },
      {
        icon: ListTodo,
        iconBg: "bg-blue-100 group-hover:bg-primary",
        iconColor: "text-blue-700 group-hover:text-primary-foreground",
        title: "Ticket queue",
        description: "What tickets are queued right now?",
        prompt: "What tickets are queued right now?",
      },
      {
        icon: Hammer,
        iconBg: "bg-orange-100 group-hover:bg-primary",
        iconColor: "text-orange-600 group-hover:text-primary-foreground",
        title: "Active forges",
        description: "What tickets are being forged right now?",
        prompt: "What tickets are being forged right now?",
      },
      {
        icon: GitPullRequest,
        iconBg: "bg-purple-100 group-hover:bg-primary",
        iconColor: "text-purple-700 group-hover:text-primary-foreground",
        title: "Recent PRs",
        description: "Show recent PRs created by Get Shit Done",
        prompt: "Show recent PRs created by Get Shit Done",
      },
      {
        icon: Info,
        iconBg: "bg-accent group-hover:bg-primary",
        iconColor: "text-accent-foreground group-hover:text-primary-foreground",
        title: "How it works",
        description: "How does Get Shit Done work?",
        prompt: "How does Get Shit Done work?",
      },
      {
        icon: FileText,
        iconBg: "bg-slate-100 group-hover:bg-primary",
        iconColor: "text-slate-600 group-hover:text-primary-foreground",
        title: "Last run logs",
        description: "Show Get Shit Done logs",
        prompt: "Show Get Shit Done logs",
      },
    ],
  }),
  defineAgent({
    name: "release-log-sentinel",
    alias: "rls",
    displayName: "Release Log Sentinel",
    description:
      "Monitor Claude Code releases: fetch and analyze release notes, check for JSONL format " +
      "changes that could break claude-code-trace, and create GitHub issues for new breaking changes. " +
      "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
      "or when asked to 'check Claude Code releases', 'scan release notes', or 'monitor for breaking changes'. " +
      "Requires gh CLI authentication.",

    icon: Radar,
    scheduleDisplay: "Sun 10:00",
    schedule: { type: "calendar", hour: 10, minute: 0, weekday: 0 },
    doveCard: {
      icon: Radar,
      iconBg: "bg-blue-100 group-hover:bg-primary",
      iconColor: "text-blue-700 group-hover:text-primary-foreground",
      title: "Release Log Sentinel",
      description: "Run the Release Log Sentinel",
      prompt: "Run the Release Log Sentinel",
    },
    suggestions: [
      {
        icon: Radar,
        iconBg: "bg-blue-100 group-hover:bg-primary",
        iconColor: "text-blue-700 group-hover:text-primary-foreground",
        title: "Run now",
        description: "Run Release Log Sentinel now",
        prompt: "Run Release Log Sentinel now",
      },
      {
        icon: AlertTriangle,
        iconBg: "bg-yellow-100 group-hover:bg-primary",
        iconColor: "text-yellow-700 group-hover:text-primary-foreground",
        title: "Breaking changes",
        description: "What breaking changes were found?",
        prompt: "What breaking changes were found?",
      },
      {
        icon: RefreshCw,
        iconBg: "bg-green-100 group-hover:bg-primary",
        iconColor: "text-green-700 group-hover:text-primary-foreground",
        title: "Latest releases",
        description: "Check for new Claude Code releases",
        prompt: "Check for new Claude Code releases",
      },
      {
        icon: FileText,
        iconBg: "bg-slate-100 group-hover:bg-primary",
        iconColor: "text-slate-600 group-hover:text-primary-foreground",
        title: "Release notes",
        description: "Show recent Claude Code release notes",
        prompt: "Show recent Claude Code release notes",
      },
      {
        icon: Info,
        iconBg: "bg-accent group-hover:bg-primary",
        iconColor: "text-accent-foreground group-hover:text-primary-foreground",
        title: "What does it do?",
        description: "What does Release Log Sentinel do?",
        prompt: "What does Release Log Sentinel do?",
      },
      {
        icon: BookOpen,
        iconBg: "bg-purple-100 group-hover:bg-primary",
        iconColor: "text-purple-700 group-hover:text-primary-foreground",
        title: "Last run logs",
        description: "Show Release Log Sentinel logs",
        prompt: "Show Release Log Sentinel logs",
      },
    ],
  }),
  defineAgent({
    name: "memory-distiller",
    alias: "md",
    displayName: "Memory Distiller",
    description:
      "Distil and promote common memory patterns across projects into the global ~/.claude/CLAUDE.md. " +
      "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
      "or when asked to 'consolidate memories', 'promote patterns to global', 'summarize memories " +
      "to be generic', or 'extract common learnings across projects'. " +
      "Requires PROJECTS env var listing ≥2 project names.",

    icon: FlaskConical,
    scheduleDisplay: "Daily 01:00",
    schedule: { type: "calendar", hour: 1, minute: 0 },
    doveCard: {
      icon: FlaskConical,
      iconBg: "bg-purple-100 group-hover:bg-primary",
      iconColor: "text-purple-700 group-hover:text-primary-foreground",
      title: "Memory Distiller",
      description: "Explain the Memory Distiller",
      prompt: "Explain the Memory Distiller",
    },
    suggestions: [
      {
        icon: FlaskConical,
        iconBg: "bg-purple-100 group-hover:bg-primary",
        iconColor: "text-purple-700 group-hover:text-primary-foreground",
        title: "Run now",
        description: "Run Memory Distiller now",
        prompt: "Run Memory Distiller now",
      },
      {
        icon: TrendingUp,
        iconBg: "bg-green-100 group-hover:bg-primary",
        iconColor: "text-green-700 group-hover:text-primary-foreground",
        title: "Promoted patterns",
        description: "What patterns were promoted to global memory?",
        prompt: "What patterns were promoted to global memory?",
      },
      {
        icon: BookOpen,
        iconBg: "bg-blue-100 group-hover:bg-primary",
        iconColor: "text-blue-700 group-hover:text-primary-foreground",
        title: "Global memory",
        description: "Show the current global memory state",
        prompt: "Show the current global memory state",
      },
      {
        icon: Info,
        iconBg: "bg-accent group-hover:bg-primary",
        iconColor: "text-accent-foreground group-hover:text-primary-foreground",
        title: "How it works",
        description: "Explain how Memory Distiller works",
        prompt: "Explain how Memory Distiller works",
      },
      {
        icon: FileText,
        iconBg: "bg-slate-100 group-hover:bg-primary",
        iconColor: "text-slate-600 group-hover:text-primary-foreground",
        title: "Last run logs",
        description: "Show Memory Distiller logs",
        prompt: "Show Memory Distiller logs",
      },
      {
        icon: Search,
        iconBg: "bg-orange-100 group-hover:bg-primary",
        iconColor: "text-orange-600 group-hover:text-primary-foreground",
        title: "Which projects?",
        description: "Which projects does Memory Distiller cover?",
        prompt: "Which projects does Memory Distiller cover?",
      },
    ],
  }),
  defineAgent({
    name: "oncall-analyzer",
    alias: "oa",
    displayName: "Oncall Analyzer",
    description:
      "Analyze on-call incidents and generate Post Incident Records (PIRs) from observability " +
      "data (PagerDuty, Datadog, Cloudflare, Rollbar). " +
      "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
      "or when asked to 'analyze oncall issues', 'generate a PIR', 'investigate incidents', " +
      "'what went wrong on-call', or 'summarize recent incidents'. Covers the past 24 hours by default. " +
      "Pass the instruction directly, e.g. 'incidents today', 'P1AB1234', " +
      "or 'past 6 hours example.com:zone123'. Requires REPO_LIST env var.",

    icon: BellRing,
    scheduleDisplay: "daily 09:00",
    schedule: { type: "calendar", hour: 9, minute: 0 },
    doveCard: {
      icon: BellRing,
      iconBg: "bg-red-100 group-hover:bg-primary",
      iconColor: "text-red-600 group-hover:text-primary-foreground",
      title: "Oncall Analyzer",
      description: "Run the Oncall Analyzer",
      prompt: "Run the Oncall Analyzer",
    },
    suggestions: [
      {
        icon: BellRing,
        iconBg: "bg-red-100 group-hover:bg-primary",
        iconColor: "text-red-600 group-hover:text-primary-foreground",
        title: "Analyze today",
        description: "Analyze today's on-call incidents",
        prompt: "Analyze today's on-call incidents",
      },
      {
        icon: FileText,
        iconBg: "bg-blue-100 group-hover:bg-primary",
        iconColor: "text-blue-700 group-hover:text-primary-foreground",
        title: "Generate PIR",
        description: "Generate a Post Incident Record",
        prompt: "Generate a Post Incident Record",
      },
      {
        icon: AlertTriangle,
        iconBg: "bg-yellow-100 group-hover:bg-primary",
        iconColor: "text-yellow-700 group-hover:text-primary-foreground",
        title: "What went wrong?",
        description: "What went wrong on-call recently?",
        prompt: "What went wrong on-call recently?",
      },
      {
        icon: Clock,
        iconBg: "bg-orange-100 group-hover:bg-primary",
        iconColor: "text-orange-600 group-hover:text-primary-foreground",
        title: "Last 6 hours",
        description: "Show incidents from the past 6 hours",
        prompt: "Show incidents from the past 6 hours",
      },
      {
        icon: Info,
        iconBg: "bg-accent group-hover:bg-primary",
        iconColor: "text-accent-foreground group-hover:text-primary-foreground",
        title: "What does it do?",
        description: "What does Oncall Analyzer do?",
        prompt: "What does Oncall Analyzer do?",
      },
      {
        icon: BookOpen,
        iconBg: "bg-slate-100 group-hover:bg-primary",
        iconColor: "text-slate-600 group-hover:text-primary-foreground",
        title: "Last run logs",
        description: "Show Oncall Analyzer logs",
        prompt: "Show Oncall Analyzer logs",
      },
    ],
  }),
  defineAgent({
    name: "zendesk-triager",
    alias: "zt",
    displayName: "Zendesk Triager",
    description:
      "Investigate Zendesk support tickets by searching configured Slack channels for ticket " +
      "discussions within a time scope, clustering by theme, and digging into configured repos " +
      "to surface potential root causes. " +
      "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
      "or when asked to 'triage zendesk', 'investigate support issues', 'what are customers reporting', " +
      "or 'find root cause for support tickets'. Pass a time scope, e.g. 'last 7 days' or 'last 2 weeks'. " +
      "Requires REPO_LIST, SLACK_WORKSPACE, and ZENDESK_SLACK_CHANNELS env vars.",

    icon: LifeBuoy,
    scheduleDisplay: "on demand",
    doveCard: {
      icon: LifeBuoy,
      iconBg: "bg-blue-100 group-hover:bg-primary",
      iconColor: "text-blue-700 group-hover:text-primary-foreground",
      title: "Zendesk Triager",
      description: "Triage recent Zendesk tickets",
      prompt: "Triage recent Zendesk tickets",
    },
    suggestions: [
      {
        icon: LifeBuoy,
        iconBg: "bg-blue-100 group-hover:bg-primary",
        iconColor: "text-blue-700 group-hover:text-primary-foreground",
        title: "Triage last 7 days",
        description: "Triage Zendesk tickets from the last 7 days",
        prompt: "Triage Zendesk tickets from the last 7 days",
      },
      {
        icon: Search,
        iconBg: "bg-purple-100 group-hover:bg-primary",
        iconColor: "text-purple-700 group-hover:text-primary-foreground",
        title: "Find root causes",
        description: "Find root causes for recent support tickets",
        prompt: "Find root causes for recent support tickets",
      },
      {
        icon: TrendingUp,
        iconBg: "bg-orange-100 group-hover:bg-primary",
        iconColor: "text-orange-600 group-hover:text-primary-foreground",
        title: "Ticket themes",
        description: "Summarize recent Zendesk ticket themes",
        prompt: "Summarize recent Zendesk ticket themes",
      },
      {
        icon: AlertTriangle,
        iconBg: "bg-yellow-100 group-hover:bg-primary",
        iconColor: "text-yellow-700 group-hover:text-primary-foreground",
        title: "Customer issues",
        description: "What are customers reporting right now?",
        prompt: "What are customers reporting right now?",
      },
      {
        icon: Info,
        iconBg: "bg-accent group-hover:bg-primary",
        iconColor: "text-accent-foreground group-hover:text-primary-foreground",
        title: "How it works",
        description: "How does Zendesk Triager work?",
        prompt: "How does Zendesk Triager work?",
      },
      {
        icon: FileText,
        iconBg: "bg-slate-100 group-hover:bg-primary",
        iconColor: "text-slate-600 group-hover:text-primary-foreground",
        title: "Last run logs",
        description: "Show Zendesk Triager logs",
        prompt: "Show Zendesk Triager logs",
      },
    ],
  }),
  defineAgent({
    name: "dependabot-merger",
    alias: "dm",
    displayName: "Dependabot Merger",
    description:
      "Review, risk-assess, and merge Dependabot PRs across configured repos. Maps each PR to " +
      "the correct Jira Kanban ticket, prepends [Ticket ID] to the PR title, and merges safe PRs " +
      "automatically. Reports blockers with risk reasoning and confidence scores. " +
      "Use when asked anything about this agent not limited to — what it does, its status, recent runs, or logs — " +
      "or when asked to 'process dependabot PRs', 'merge dependabot', 'triage dependency PRs', " +
      "or 'review dependency updates'. Pass 'dry-run' to preview without merging. " +
      "Requires REPO_LIST (local repo paths).",

    icon: GitMerge,
    scheduleDisplay: "daily 10:00",
    schedule: { type: "calendar", hour: 10, minute: 0 },
    doveCard: {
      icon: GitMerge,
      iconBg: "bg-green-100 group-hover:bg-primary",
      iconColor: "text-green-700 group-hover:text-primary-foreground",
      title: "Dependabot Merger",
      description: "Review and merge Dependabot PRs",
      prompt: "Review and merge Dependabot PRs",
    },
    suggestions: [
      {
        icon: GitMerge,
        iconBg: "bg-green-100 group-hover:bg-primary",
        iconColor: "text-green-700 group-hover:text-primary-foreground",
        title: "Review PRs",
        description: "Review and merge Dependabot PRs",
        prompt: "Review and merge Dependabot PRs",
      },
      {
        icon: Eye,
        iconBg: "bg-blue-100 group-hover:bg-primary",
        iconColor: "text-blue-700 group-hover:text-primary-foreground",
        title: "Dry-run preview",
        description: "Run Dependabot Merger in dry-run mode",
        prompt: "Run Dependabot Merger dry-run",
      },
      {
        icon: AlertTriangle,
        iconBg: "bg-yellow-100 group-hover:bg-primary",
        iconColor: "text-yellow-700 group-hover:text-primary-foreground",
        title: "Blocked PRs",
        description: "Show blocked Dependabot PRs",
        prompt: "Show blocked Dependabot PRs",
      },
      {
        icon: CheckCircle,
        iconBg: "bg-green-100 group-hover:bg-primary",
        iconColor: "text-green-600 group-hover:text-primary-foreground",
        title: "Safe to merge",
        description: "Which Dependabot PRs are safe to merge?",
        prompt: "Which Dependabot PRs are safe to merge?",
      },
      {
        icon: Info,
        iconBg: "bg-accent group-hover:bg-primary",
        iconColor: "text-accent-foreground group-hover:text-primary-foreground",
        title: "How it works",
        description: "How does Dependabot Merger work?",
        prompt: "How does Dependabot Merger work?",
      },
      {
        icon: FileText,
        iconBg: "bg-slate-100 group-hover:bg-primary",
        iconColor: "text-slate-600 group-hover:text-primary-foreground",
        title: "Last run logs",
        description: "Show Dependabot Merger logs",
        prompt: "Show Dependabot Merger logs",
      },
    ],
  }),
];

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
