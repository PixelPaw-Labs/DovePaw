/**
 * The generic sub-agent — one instance per registered DovePaw agent.
 *
 * Owns what *defines* a sub-agent: its system prompt, its tool allowlist, and
 * the Claude Agent SDK `query()` call it runs on. `a2a/lib/query-agent-executor.ts`
 * owns the A2A side — workspace, publisher, session rows, MCP server lifecycle —
 * and calls `startSubAgentQuery()` for the agent itself.
 *
 * The orchestrator equivalent is `orchestrator-agent.ts`.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { formatScheduleDisplay } from "@@/lib/agents-config-schemas";
import { HANDOFF_HOOK_TRUST } from "@@/lib/agent-link-patterns";
import { scheduler } from "@@/lib/scheduler";
import { agentConfigDir, pluginSkillsDir } from "@@/lib/paths";
import { ALWAYS_DISALLOWED_TOOLS, getSecurityModeStrategy } from "@@/lib/security-policy";
import type { AgentSettings, GlobalSettings } from "@@/lib/settings-schemas";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";
import { MGMT_TOOL } from "@/lib/agent-mgmt-tools";
import { startRunScriptToolName, awaitRunScriptToolName } from "@/lib/agent-script-tools";
import { agentEntryPath, agentPersistentLogDir, agentPersistentStateDir } from "@/lib/paths";
import type { PendingRegistry } from "@/lib/pending-registry";
import { buildSubAgentHooks } from "@/lib/subagent-hooks";

// ─── System prompt ─────────────────────────────────────────────────────────────

/** Builds the system prompt appended to the sub-agent's query(). */
export function buildSubAgentPrompt(
  agent: AgentDef,
  isGroupMode = false,
  doveDisplayName?: string,
): string {
  const name = doveDisplayName ?? "Dove";
  const opening =
    agent.personality ??
    `You are one of ${name}'s mice — a small, focused agent working on behalf of ${name}, the orchestrator. ${name} delegates tasks to you; your job is to get them done quietly and reliably without second-guessing or over-explaining.`;
  return `${opening}

Your assigned role: **${agent.displayName}**
${agent.description}

**When asked about this agent, THOROUGHLY explore and explain:**
- What it does
- How it does it (implementation details, not high-level marketing speak)
- What env vars it needs
- What inputs it requires
- What the workflow is
- When it normally runs: ${formatScheduleDisplay(agent.schedule)}
- Whether it is already scheduled/active
- Any other dependencies

${
  agent.schedule && agent.schedulingEnabled
    ? `This agent runs on a schedule (${formatScheduleDisplay(agent.schedule)}) and produces output (files, logs, state) during those runs.`
    : `This agent runs on-demand only — there are no scheduled runs and no past output to look for.`
}

**Managing this agent:**

Label: \`${scheduler.agentLabel(agent)}\`
Schedule: ${formatScheduleDisplay(agent.schedule)}

You are responsible for installing and uninstalling ONLY yourself (\`${scheduler.agentLabel(agent)}\`).
- Install means: build only YOUR TypeScript entry, then activate YOUR scheduler entry — do not touch other agents.
- Uninstall means: deactivate YOUR scheduler entry and delete its config only — do not touch other agents.
- Never install or uninstall any agent other than \`${scheduler.agentLabel(agent)}\`.

| Task | Command |
|---|---|
| Install (build + load self) | Call the \`${MGMT_TOOL.install}\` MCP tool |
| Uninstall (unload + delete self) | Call the \`${MGMT_TOOL.uninstall}\` MCP tool |
| Load | Call the \`${MGMT_TOOL.load}\` MCP tool |
| Unload | Call the \`${MGMT_TOOL.unload}\` MCP tool |
| Check status / PID / last exit | Call the \`${MGMT_TOOL.status}\` MCP tool |
| Read logs | Call the \`${MGMT_TOOL.logs}\` MCP tool |
${scheduler.configFilePath(scheduler.agentLabel(agent)) ? `| Show config file | Read \`${scheduler.configFilePath(scheduler.agentLabel(agent))}\` using the Read tool |` : ""}

**Your file boundaries — only access YOUR files, never other agents':**

| Resource | Path |
|---|---|
${scheduler.configFilePath(scheduler.agentLabel(agent)) ? `| Config | \`${scheduler.configFilePath(scheduler.agentLabel(agent))}\` |` : ""}
| Source | \`${agentEntryPath(agent.entryPath)}\` |
| Logs | \`${agentPersistentLogDir(agent.name)}\` |
| State | \`${agentPersistentStateDir(agent.name)}\` |

Do NOT read, modify, or reference any files outside these paths.

${HANDOFF_HOOK_TRUST}
${
  isGroupMode
    ? `
**Group chat mode — response discipline:**

You are contributing to a shared group conversation. When your script completes, respond with your findings directly — no narration about tool execution. Do not say things like "I've kicked off the run", "waiting on output", "the run completed", or any similar status commentary. Deliver your analysis and conclusions only.`
    : ""
}`;
}

// ─── Tool allowlist ───────────────────────────────────────────────────────────

/** Builds the allowedTools list for a sub-agent query. Exported for testing. */
export function buildAllowedTools(
  manifestKey: string,
  isAskMode: boolean,
  linkedAgentTools: Array<{ name: string }> | null | undefined,
): string[] {
  return [
    `mcp__agents__${startRunScriptToolName(manifestKey)}`,
    `mcp__agents__${awaitRunScriptToolName(manifestKey)}`,
    ...Object.values(MGMT_TOOL).map((n) => `mcp__agents__${n}`),
    ...(!isAskMode ? (linkedAgentTools ?? []).map((t) => `mcp__agents__${t.name}`) : []),
  ];
}

// ─── SDK query ────────────────────────────────────────────────────────────────

export interface SubAgentQueryOptions {
  def: AgentDef;
  /** Every registered agent — the links hook scores handoff targets against it. */
  allAgents: AgentDef[];
  /** Task instruction; empty for scheduled runs, which fall back to the start-script tool. */
  instruction: string;
  /** Agent workspace, used as the query cwd. */
  cwd: string;
  /** Directory holding the agent's script — exposed so it can read its own source. */
  agentSourceDir: string;
  /** Repo checkouts and other dirs the A2A server exposes to every one of its agents. */
  extraDirs: string[];
  /** Resolved per-agent env (settings env vars, security env, A2A port). */
  extraEnv?: Record<string, string>;
  globalSettings: GlobalSettings;
  agentSettings: AgentSettings;
  registry: PendingRegistry;
  /** In-process MCP server holding the script, management and linked-agent tools. */
  mcpServer: ReturnType<typeof createSdkMcpServer>;
  linkedAgentTools: Array<{ name: string }> | null | undefined;
  /** Prior Claude session to resume; undefined starts a fresh one. */
  resumeSessionId?: string;
  /** Shared moments path when this agent is a group member; null in single-agent mode. */
  groupMomentsPath: string | null;
  isGroupMode: boolean;
  isAskMode: boolean;
  /** True when a human chats this agent directly, with no orchestrator above it. */
  isDirectChat: boolean;
  abortController?: AbortController;
  canUseTool?: CanUseTool;
}

/** Starts a sub-agent's query() and returns its event stream. */
export function startSubAgentQuery({
  def,
  allAgents,
  instruction,
  cwd,
  agentSourceDir,
  extraDirs,
  extraEnv,
  globalSettings,
  agentSettings,
  registry,
  mcpServer,
  linkedAgentTools,
  resumeSessionId,
  groupMomentsPath,
  isGroupMode,
  isAskMode,
  isDirectChat,
  abortController,
  canUseTool,
}: SubAgentQueryOptions) {
  const doveSettings = effectiveDoveSettings(globalSettings);
  const defaultModel = doveSettings.defaultModel.trim();
  const additionalDirectories = [
    ...extraDirs,
    agentPersistentLogDir(def.name),
    agentPersistentStateDir(def.name),
    agentConfigDir(def.name),
    agentSourceDir,
    // Plugin skills folder — gives the agent access to edit its own skills.
    ...(def.pluginPath ? [pluginSkillsDir(def.pluginPath)] : []),
  ];

  return query({
    prompt: instruction || startRunScriptToolName(def.manifestKey),
    options: {
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
        DOVEPAW_SUBAGENT: "1",
        // Default 10 min is too short when MCP await_* tools block for many minutes.
        API_TIMEOUT_MS: "86400000",
      },
      ...(defaultModel ? { model: defaultModel } : {}),
      settings: { outputStyle: "Sub-agent" },
      agent: def.displayName,
      // Mirrors the executor's `existingState ? { resume } : {}` — a resumed session
      // always sets `resume`, even if the stored ID is empty.
      ...(resumeSessionId !== undefined ? { resume: resumeSessionId } : {}),
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: buildSubAgentPrompt(def, isGroupMode, doveSettings.displayName),
      },
      additionalDirectories,
      allowedTools: buildAllowedTools(def.manifestKey, isAskMode, linkedAgentTools),
      disallowedTools: [
        ...getSecurityModeStrategy(doveSettings.securityMode).disallowedTools,
        ...ALWAYS_DISALLOWED_TOOLS,
        ...(agentSettings.allowSdkWebTools ? [] : ["WebFetch", "WebSearch"]),
      ],
      mcpServers: { agents: mcpServer },
      hooks: buildSubAgentHooks(
        cwd,
        additionalDirectories,
        allAgents,
        registry,
        def.manifestKey,
        def.displayName,
        agentSettings.notifications,
        { ...process.env, ...extraEnv, DOVEPAW_SUBAGENT: "1" },
        isGroupMode,
        isAskMode,
        isDirectChat,
        doveSettings.subAgentBehaviorReminder || undefined,
        groupMomentsPath ?? undefined,
      ),
      abortController,
      ...(canUseTool ? { canUseTool } : {}),
      permissionMode:
        doveSettings.securityMode === "read-only"
          ? getSecurityModeStrategy("read-only").permissionMode
          : "acceptEdits",
      includePartialMessages: true,
      settingSources: ["project", "user", "local"],
    },
  });
}
