import type { LucideIcon } from "lucide-react";
import { Brain, Zap, Radar, FlaskConical, BellRing, LifeBuoy, GitMerge } from "lucide-react";

const TOOL_PREFIX = "yolo";

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
  /** Required environment variables (checked at startup) */
  requiredEnvVars: string[];
  /**
   * The env var key under which this agent's assigned repositories (from settings.agentRepos)
   * will be injected as a comma-separated list of githubRepo slugs.
   * When absent, no repos env var is set for this agent.
   */
  reposEnvVar?: string;
  /** Human-readable schedule string for UI display */
  scheduleDisplay: string;
  /** launchd schedule */
  schedule?:
    | { type: "interval"; seconds: number }
    | { type: "calendar"; hour: number; minute: number; weekday?: number };
  /** Icon component for UI display */
  icon: LucideIcon;
  /** Whether to run immediately when loaded */
  runAtLoad?: boolean;
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
    name: "experience-reflector",
    alias: "er",
    displayName: "Experience Reflector",
    description:
      "Reflect on and learn from past Claude Code sessions: fetches the last 24 hours of sessions " +
      "via the local session API, extracts domain knowledge and user preferences, and writes " +
      "learnings into project MEMORY.md files. " +
      "Use when asked anything about this agent — what it does, its status, recent runs, or logs — " +
      "or when asked to 'learn from sessions', 'rewind and learn', or 'reflect on past Claude Code work'. " +
      "Requires PROJECTS env var.",
    requiredEnvVars: ["PROJECTS"],
    icon: Brain,
    scheduleDisplay: "daily 00:00",
    schedule: { type: "calendar", hour: 0, minute: 0 },
  }),
  defineAgent({
    name: "get-shit-done",
    alias: "gsd",
    displayName: "Get Shit Done",
    description:
      "Automated JIRA ticket implementer: discovers Kanban tickets, forges implementations in " +
      "parallel git worktrees, and creates PRs. " +
      "Use when asked anything about this agent — what it does, its status, recent runs, or logs — " +
      "or when asked to 'run GSD', 'process tickets', 'forge JIRA tickets', or 'start the pipeline'. " +
      "Requires REPO_LIST + JIRA_ASSIGNEE env vars.",
    requiredEnvVars: ["REPO_LIST", "JIRA_ASSIGNEE"],
    reposEnvVar: "REPO_LIST",
    icon: Zap,
    scheduleDisplay: "every 5 min",
    schedule: { type: "interval", seconds: 300 },
  }),
  defineAgent({
    name: "release-log-sentinel",
    alias: "rls",
    displayName: "Release Log Sentinel",
    description:
      "Monitor Claude Code releases: fetch and analyze release notes, check for JSONL format " +
      "changes that could break claude-code-trace, and create GitHub issues for new breaking changes. " +
      "Use when asked anything about this agent — what it does, its status, recent runs, or logs — " +
      "or when asked to 'check Claude Code releases', 'scan release notes', or 'monitor for breaking changes'. " +
      "Requires gh CLI authentication.",
    requiredEnvVars: [],
    icon: Radar,
    scheduleDisplay: "Sun 10:00",
    schedule: { type: "calendar", hour: 10, minute: 0, weekday: 0 },
  }),
  defineAgent({
    name: "memory-distiller",
    alias: "md",
    displayName: "Memory Distiller",
    description:
      "Distil and promote common memory patterns across projects into the global ~/.claude/CLAUDE.md. " +
      "Use when asked anything about this agent — what it does, its status, recent runs, or logs — " +
      "or when asked to 'consolidate memories', 'promote patterns to global', 'summarize memories " +
      "to be generic', or 'extract common learnings across projects'. " +
      "Requires PROJECTS env var listing ≥2 project names.",
    requiredEnvVars: ["PROJECTS"],
    icon: FlaskConical,
    scheduleDisplay: "Sun 01:00",
    schedule: { type: "calendar", hour: 1, minute: 0, weekday: 0 },
  }),
  defineAgent({
    name: "oncall-analyzer",
    alias: "oa",
    displayName: "Oncall Analyzer",
    description:
      "Analyze on-call incidents and generate Post Incident Records (PIRs) from observability " +
      "data (PagerDuty, Datadog, Cloudflare, Rollbar). " +
      "Use when asked anything about this agent — what it does, its status, recent runs, or logs — " +
      "or when asked to 'analyze oncall issues', 'generate a PIR', 'investigate incidents', " +
      "'what went wrong on-call', or 'summarize recent incidents'. Covers the past 24 hours by default. " +
      "Pass the instruction directly, e.g. 'incidents today', 'P1AB1234', " +
      "or 'past 6 hours example.com:zone123'. Requires REPO_LIST env var.",
    requiredEnvVars: ["REPO_LIST"],
    reposEnvVar: "REPO_LIST",
    icon: BellRing,
    scheduleDisplay: "daily 09:00",
    schedule: { type: "calendar", hour: 9, minute: 0 },
  }),
  defineAgent({
    name: "zendesk-triager",
    alias: "zt",
    displayName: "Zendesk Triager",
    description:
      "Investigate Zendesk support tickets by searching configured Slack channels for ticket " +
      "discussions within a time scope, clustering by theme, and digging into configured repos " +
      "to surface potential root causes. " +
      "Use when asked anything about this agent — what it does, its status, recent runs, or logs — " +
      "or when asked to 'triage zendesk', 'investigate support issues', 'what are customers reporting', " +
      "or 'find root cause for support tickets'. Pass a time scope, e.g. 'last 7 days' or 'last 2 weeks'. " +
      "Requires REPO_LIST, SLACK_WORKSPACE, and ZENDESK_SLACK_CHANNELS env vars.",
    requiredEnvVars: ["REPO_LIST", "SLACK_WORKSPACE", "ZENDESK_SLACK_CHANNELS"],
    reposEnvVar: "REPO_LIST",
    icon: LifeBuoy,
    scheduleDisplay: "on demand",
  }),
  defineAgent({
    name: "dependabot-merger",
    alias: "dm",
    displayName: "Dependabot Merger",
    description:
      "Review, risk-assess, and merge Dependabot PRs across configured repos. Maps each PR to " +
      "the correct Jira Kanban ticket, prepends [Ticket ID] to the PR title, and merges safe PRs " +
      "automatically. Reports blockers with risk reasoning and confidence scores. " +
      "Use when asked anything about this agent — what it does, its status, recent runs, or logs — " +
      "or when asked to 'process dependabot PRs', 'merge dependabot', 'triage dependency PRs', " +
      "or 'review dependency updates'. Pass 'dry-run' to preview without merging. " +
      "Requires REPO_LIST (local repo paths).",
    requiredEnvVars: ["REPO_LIST"],
    reposEnvVar: "REPO_LIST",
    icon: GitMerge,
    scheduleDisplay: "daily 10:00",
    schedule: { type: "calendar", hour: 10, minute: 0 },
  }),
];
