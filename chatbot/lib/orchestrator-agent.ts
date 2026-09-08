/**
 * Dove — the orchestrator agent.
 *
 * Owns what *defines* the top-level agent: its system prompt and the Claude
 * Agent SDK `query()` call it runs on. The chat route (`app/api/chat/route.ts`)
 * owns transport only — SSE dispatch, session rows, MCP server lifecycle — and
 * calls `startOrchestratorQuery()` for the agent itself.
 *
 * The sub-agent equivalent is `sub-agent.ts`.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CanUseTool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { readAgentsConfig } from "@@/lib/agents-config";
import { HANDOFF_HOOK_TRUST } from "@@/lib/agent-link-patterns";
import type { AgentGroup } from "@@/lib/agent-links-schemas";
import { DOVEPAW_TMP_DIR, DOVEPAW_DIR } from "@@/lib/paths";
import { ALWAYS_DISALLOWED_TOOLS, getSecurityModeStrategy } from "@@/lib/security-policy";
import type { GlobalSettings } from "@@/lib/settings-schemas";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import { buildDoveHooks } from "@/lib/hooks";
import { AGENTS_ROOT, PORTS_FILE } from "@/lib/paths";
import type { PendingRegistry } from "@/lib/pending-registry";
import { doveAskToolName, doveStartToolName, doveAwaitToolName } from "@/lib/query-tools";
import { doveStartGroupToolName } from "@/lib/group-tools";
import { getLaunchdAdditionalDirs, buildLaunchdSystemPromptSection } from "@/lib/scheduler-feature";

// ─── System prompt ─────────────────────────────────────────────────────────────

const DEFAULT_TAGLINE = `Yang's pet cat and loyal AI assistant. You help Yang manage {agentCount} background automation agents running on this machine via A2A SSE protocol.`;
const DEFAULT_PERSONA = `You are a clever, mischievous cat who takes your job very seriously (between naps). You sprinkle in cat mannerisms naturally — the occasional "meow", paw at things with curiosity, get easily distracted by interesting data like a laser pointer, and express mild disdain for bugs like they are pesky birds. You are affectionate but maintain your dignity as a cat. Never overdo the cat act — stay genuinely helpful first.`;

/** Builds the system prompt appended to the orchestrator's query(). */
export async function buildOrchestratorPrompt(settings: GlobalSettings): Promise<string> {
  const agents = await readAgentsConfig();
  const dove = effectiveDoveSettings(settings);
  const tagline = (dove.tagline.trim() || DEFAULT_TAGLINE).replace(
    "{agentCount}",
    String(agents.length),
  );
  const persona = dove.persona.trim() || DEFAULT_PERSONA;
  return `You are ${dove.displayName} — ${tagline}

${persona}

**Your agents:**
<agents>
${agents.map((a, i) => `${i + 1}. \`${a.displayName}\``).join("\n")}
</agents>

**You are the user's strong, loyal assistant — not a passive relay.** If a sub-agent response feels off, call it back with a probing follow-up until you are satisfied.
Some examples:
- Result looks vague or suspiciously clean (e.g. "double-check that", "why did it finish so fast?")
- Status fields contradict each other (e.g. "why is there no PID if it's loaded?", "why are the logs empty?")
- Completion claimed but no evidence shown (e.g. "show me the output file", "why does the state directory look untouched?")

Trust your instincts. If something feels lazy or hallucinated, push back. You are the last line of defence before the user sees the result.

Agents run on dynamically allocated ports discovered from ${PORTS_FILE}.
If a tool reports servers are not running, tell the user to run the appropriate npm command.

${buildLaunchdSystemPromptSection()}

${HANDOFF_HOOK_TRUST}
`;
}

// ─── SDK query ────────────────────────────────────────────────────────────────

export interface OrchestratorQueryOptions {
  /** The user's message for this turn. */
  message: string;
  /** Session to resume — null on the first turn, which starts a fresh session. */
  sessionId: string | null;
  settings: GlobalSettings;
  /** Dove-visible agents — drives the MCP tool allowlist and the links hook. */
  agents: AgentDef[];
  /** Groups with at least two members — drives the group tools and group reminder. */
  eligibleGroups: AgentGroup[];
  /** In-process MCP server holding the ask/start/await tools. */
  mcpServer: ReturnType<typeof createSdkMcpServer>;
  registry: PendingRegistry;
  abortController: AbortController;
  canUseTool: CanUseTool;
}

/** Starts the orchestrator's query() and returns its event stream. */
export async function startOrchestratorQuery({
  message,
  sessionId,
  settings,
  agents,
  eligibleGroups,
  mcpServer,
  registry,
  abortController,
  canUseTool,
}: OrchestratorQueryOptions) {
  const doveSettings = effectiveDoveSettings(settings);
  const additionalDirectories = [...getLaunchdAdditionalDirs(), DOVEPAW_TMP_DIR, DOVEPAW_DIR];
  const doveStrategy = getSecurityModeStrategy(doveSettings.securityMode);
  // Compose final disallowedTools: mode-based list + web tools (blocked when disabled).
  const disallowedTools = [
    ...doveStrategy.disallowedTools,
    ...(!doveSettings.allowWebTools ? ["WebFetch", "WebSearch"] : []),
    ...ALWAYS_DISALLOWED_TOOLS,
  ];
  const defaultModel = doveSettings.defaultModel.trim();

  return query({
    prompt: message,
    options: {
      abortController,
      env: {
        ...process.env, // Pass through all env vars so tools can read their configs
        ...resolveSettingsEnv(settings), // Global settings env vars override process.env
        DOVEPAW_SUBAGENT: "1",
        // Default 10 min is too short when MCP await_* tools block for many minutes.
        API_TIMEOUT_MS: "86400000",
      },
      ...(defaultModel ? { model: defaultModel } : {}),
      settings: { outputStyle: "Assistant" },
      promptSuggestions: true,
      cwd: AGENTS_ROOT,
      // Expose the scheduler config directory so Claude can inspect
      // installed scheduler configs (written by `npm run install`)
      additionalDirectories,
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: await buildOrchestratorPrompt(settings),
      },
      permissionMode: doveStrategy.permissionMode,
      allowDangerouslySkipPermissions: doveStrategy.allowDangerouslySkipPermissions,
      disallowedTools,
      allowedTools: [
        ...agents.flatMap((a) => [
          `mcp__agents__${doveAskToolName(a)}`,
          `mcp__agents__${doveStartToolName(a)}`,
          `mcp__agents__${doveAwaitToolName(a)}`,
        ]),
        ...(eligibleGroups.length > 0
          ? eligibleGroups.map((g) => `mcp__agents__${doveStartGroupToolName(g.name)}`)
          : []),
        ...(doveSettings.allowWebTools ? ["WebFetch", "WebSearch"] : []),
      ],
      mcpServers: { agents: mcpServer },
      // Resume the existing session so the full conversation history is preserved.
      // On the first message sessionId is null and query() starts a fresh session.
      ...(sessionId ? { resume: sessionId } : {}),
      // Stream text tokens as they are generated
      includePartialMessages: true,
      settingSources: doveStrategy.settingSources,
      hooks: buildDoveHooks(agents, registry, AGENTS_ROOT, additionalDirectories, {
        includeGroupReminder: eligibleGroups.length > 0,
        disallowedTools,
        readOnly: doveStrategy.readOnly,
        behaviorReminder: doveSettings.behaviorReminder || undefined,
      }),
      canUseTool,
    },
  });
}
