import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { consola } from "consola";
import type { RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import type { AgentDef } from "@@/lib/agents";
import { readAgentsConfig } from "@@/lib/agents-config";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { consumeQueryEvents, withMcpQuery } from "@/lib/query-events";
import { A2AQueryDispatcher } from "@/lib/query-dispatcher";
import type { CollectedStream } from "@/lib/a2a-client";
import { upsertProgressEntry, type ProgressEntry } from "@/lib/progress";
import { agentPersistentLogDir, agentPersistentStateDir } from "@/lib/paths";
import { agentConfigDir } from "@@/lib/paths";
import { readAgentSettings, readSettings } from "@@/lib/settings";
import { readGroupConfig } from "@@/lib/group-config";
import { resolveEnvVarList } from "@/lib/env-resolver";
import {
  ALWAYS_DISALLOWED_TOOLS,
  buildSecurityEnv,
  getSecurityModeStrategy,
} from "@@/lib/security-policy";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";
import {
  makeStartScriptTool,
  makeAwaitScriptTool,
  buildSubAgentPrompt,
  MGMT_TOOL,
  startRunScriptToolName,
  awaitRunScriptToolName,
} from "@/lib/agent-tools";
import { AgentConfigReader } from "./agent-config-reader";
import { extractInstruction } from "./message-parts";
import { buildAgentConfig } from "./agent-config-builder";
import { buildSubAgentHooks } from "@/lib/subagent-hooks";
import { AgentCallMode } from "@/lib/query-tools";
import { buildSubagentCanUseTool } from "@/lib/hooks";
import { PendingRegistry } from "@/lib/pending-registry";
import { ExecutorPublisher } from "./executor-publisher";
import { createAgentWorkspace, restoreAgentWorkspace } from "./workspace";
import type { AgentWorkspace } from "./workspace";
import { SessionManager, type SessionInfo } from "@/lib/session-manager";
import { relaySessionEvent } from "@/lib/relay-to-chatbot";

export interface ExecutorPersistence {
  upsertSession(args: {
    id: string;
    agentId: string;
    startedAt: string;
    label: string;
    messages: unknown[];
    progress: ProgressEntry[];
    status?: string;
    senderAgentId?: string;
  }): void;
  setActive(agentId: string, contextId: string): void;
  setStatus(contextId: string, status: string): void;
}
import { markProcessing, markIdle } from "./processing-registry";

/**
 * A2A executor that runs a query() sub-agent instead of spawning a script directly.
 *
 * The sub-agent receives an inner MCP server with:
 *   - run_script: spawns the agent's tsx script and returns its output
 *   - management tools: install/uninstall/load/unload/status/logs
 *
 * Settings (env vars, repo list) are resolved fresh on each execution.
 */
const LABEL_MAX_LEN = 60;

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

// ─── Group chat mode ──────────────────────────────────────────────────────────

interface GroupChatOverrides {
  groupContextId: string;
  groupMomentsPath: string;
  groupName: string;
}

/**
 * Reads group-chat context from A2A message metadata set by the group executor.
 * Returns overrides when isGroupChat is present, null for normal single-agent mode.
 */
function resolveGroupChatOverrides(
  metadata: Record<string, unknown> | undefined,
): GroupChatOverrides | null {
  if (!metadata?.isGroupChat) return null;
  const { groupContextId, groupMomentsPath, groupName } = metadata;
  if (
    typeof groupContextId !== "string" ||
    typeof groupMomentsPath !== "string" ||
    typeof groupName !== "string"
  )
    return null;
  return { groupContextId, groupMomentsPath, groupName };
}

export { SessionInfo };

export class QueryAgentExecutor {
  private abortController: AbortController | null = null;
  private readonly agentConfigReader = new AgentConfigReader();

  constructor(
    private readonly def: AgentDef,
    private readonly sessionManager: SessionManager,
    private readonly publisherRegistry?: Map<string, ExecutorPublisher>,
    private readonly port?: number,
    private readonly persistence?: ExecutorPersistence,
    private readonly mgmtTools: NonNullable<Parameters<typeof withMcpQuery>[0]> = [],
    private readonly extraDirs: string[] = [],
  ) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;
    const instruction = extractInstruction(requestContext.userMessage.parts);
    const msgMetadata = requestContext.userMessage.metadata as Record<string, unknown> | undefined;
    const groupOverrides = resolveGroupChatOverrides(msgMetadata);
    this.abortController = new AbortController();
    markProcessing(
      this.def.manifestKey,
      taskId,
      this.abortController,
      instruction ? "dove" : "scheduled",
    );

    consola.start(
      `Running ${this.def.displayName} sub-agent${groupOverrides ? " (group mode)" : ""}…`,
    );

    const publisher = new ExecutorPublisher(eventBus, taskId, contextId);
    this.publisherRegistry?.set(taskId, publisher);

    // Restore session early so publishProgress can use the correct label from the start.
    // Without this, the first upsertSession call would create the DB row with label:"",
    // and since ON CONFLICT does not update label, it would stay empty in history.
    this.sessionManager.restore(contextId, this.def.name);
    // Group-mode members always start fresh — no resume across group tasks
    const existingState = groupOverrides ? null : this.sessionManager.get(contextId);
    const startedAt = existingState?.startedAt ?? new Date();
    const label =
      existingState?.label ??
      (instruction ? instruction.slice(0, LABEL_MAX_LEN) : `Scheduled Session: ${taskId}`);
    let workspace: AgentWorkspace | null = null;
    const userMsgId = randomUUID();
    const senderAgentId =
      typeof requestContext.userMessage.metadata?.senderAgentId === "string"
        ? requestContext.userMessage.metadata.senderAgentId
        : undefined;
    const isAskMode = requestContext.userMessage.metadata?.mode === AgentCallMode.Ask;
    const backgroundTasks: Promise<CollectedStream>[] = [];

    // Track direct publishStatusToUI calls (workspace setup, clone progress, etc.)
    // so sub-agent history sessions show these entries alongside the tool-call entries
    // already captured by dispatcher.buildProgress().
    const innerProgress: ProgressEntry[] = [];
    const publishProgress = (text: string, artifacts: Record<string, string> = {}): void => {
      publisher.publishStatusToUI(text, artifacts);
      upsertProgressEntry(innerProgress, text, artifacts);
      this.persistence?.upsertSession({
        id: contextId,
        agentId: this.def.name,
        startedAt: new Date().toISOString(),
        label,
        messages: [],
        progress: innerProgress,
        status: "running",
        senderAgentId,
      });
    };

    // Publish the Task object first so ResultManager registers it in the TaskStore.
    // Without this, every subsequent event triggers a "unknown task" warning because
    // ResultManager.currentTask is only set when it sees a kind:"task" event.
    publisher.publishTask();

    this.persistence?.setActive(this.def.name, contextId);
    publishProgress("Starting…");

    const [{ extraEnv, repoSlugs: agentRepoSlugs }, agentSettings, globalSettings] =
      await Promise.all([
        this.agentConfigReader.resolveAgentSettings(this.def.name),
        readAgentSettings(this.def.name),
        readSettings(),
      ]);
    const defaultModel = effectiveDoveSettings(globalSettings).defaultModel.trim();

    // In group mode, merge group repos and env vars into the agent's own settings.
    // Group values are applied last so they take precedence over per-agent values.
    let repoSlugs = agentRepoSlugs;
    let groupExtraEnv: Record<string, string> = {};
    if (groupOverrides) {
      const groupConfig = readGroupConfig(groupOverrides.groupName);
      if (groupConfig) {
        if (groupConfig.repos.length > 0) {
          const groupRepoSlugs = groupConfig.repos
            .map((id) => globalSettings.repositories.find((r) => r.id === id))
            .filter((r): r is NonNullable<typeof r> => r !== undefined)
            .map((r) => r.githubRepo);
          repoSlugs = [...new Set([...agentRepoSlugs, ...groupRepoSlugs])];
        }
        if (groupConfig.envVars.length > 0) {
          groupExtraEnv = resolveEnvVarList(groupConfig.envVars);
        }
      }
    }

    try {
      if (existingState) {
        // Resume existing session — reuse workspace and Claude session.
        workspace = existingState.workspace;
      } else {
        // First message in this context — create a fresh workspace.
        // Group members each get their own isolated workspace; shared state
        // lives in groupMomentsPath injected via env vars / memory reminder.
        workspace = await createAgentWorkspace(
          this.def.name,
          this.def.alias,
          undefined,
          taskId,
          publishProgress,
        );
      }

      const cwd = workspace.path;

      const agentConfig = buildAgentConfig(
        this.def,
        cwd,
        {
          ...extraEnv,
          ...groupExtraEnv,
          ...buildSecurityEnv(
            effectiveDoveSettings(globalSettings).securityMode,
            agentSettings.allowScriptWebTools,
          ),
          ...(this.port ? { DOVEPAW_A2A_PORT: String(this.port) } : {}),
        },
        repoSlugs,
      );
      const agentSourceDir = dirname(agentConfig.scriptPath);

      const registry = new PendingRegistry();

      const isDirectChat = senderAgentId === undefined;
      const { tools: linkedAgentTools } = await this.agentConfigReader.resolveLinkedTools(
        this.def.name,
        this.abortController.signal,
        backgroundTasks,
        registry,
        !!groupOverrides || !isDirectChat,
      );
      const allAgents = await readAgentsConfig();

      await withMcpQuery(
        [
          makeStartScriptTool(
            this.def,
            agentConfig,
            repoSlugs,
            this.abortController.signal,
            publishProgress,
            taskId,
            registry,
            groupOverrides
              ? {
                  groupContextId: groupOverrides.groupContextId,
                  groupMomentsPath: groupOverrides.groupMomentsPath,
                }
              : undefined,
          ),
          makeAwaitScriptTool(this.def, registry),
          ...this.mgmtTools,
          ...(linkedAgentTools ?? []),
        ],
        async (innerMcpServer) => {
          const additionalDirectories = [
            ...this.extraDirs,
            agentPersistentLogDir(this.def.name),
            agentPersistentStateDir(this.def.name),
            agentConfigDir(this.def.name),
            agentSourceDir,
          ];
          const dispatcher = new A2AQueryDispatcher(
            publisher,
            contextId,
            groupOverrides
              ? { groupContextId: groupOverrides.groupContextId, agentName: this.def.name }
              : undefined,
          );

          const canUseTool =
            msgMetadata?.directUserChat === true
              ? buildSubagentCanUseTool(
                  contextId,
                  process.env.DOVEPAW_PORT ?? "7473",
                  this.abortController?.signal,
                )
              : undefined;

          const subagentSessionId = await consumeQueryEvents(
            query({
              prompt: instruction || startRunScriptToolName(this.def.manifestKey),
              options: {
                cwd,
                env: {
                  ...process.env,
                  ...agentConfig.extraEnv,
                  DOVEPAW_SUBAGENT: "1",
                  // Default 10 min is too short when MCP await_* tools block for many minutes.
                  API_TIMEOUT_MS: "86400000",
                },
                ...(defaultModel ? { model: defaultModel } : {}),
                settings: { outputStyle: "Sub-agent" },
                agent: this.def.displayName,
                ...(existingState ? { resume: existingState.subagentSessionId } : {}),
                systemPrompt: {
                  type: "preset",
                  preset: "claude_code",
                  append: buildSubAgentPrompt(
                    this.def,
                    !!groupOverrides,
                    effectiveDoveSettings(globalSettings).displayName,
                  ),
                },
                additionalDirectories,
                allowedTools: buildAllowedTools(this.def.manifestKey, isAskMode, linkedAgentTools),
                disallowedTools: [
                  ...getSecurityModeStrategy(effectiveDoveSettings(globalSettings).securityMode)
                    .disallowedTools,
                  ...ALWAYS_DISALLOWED_TOOLS,
                  ...(agentSettings.allowSdkWebTools ? [] : ["WebFetch", "WebSearch"]),
                ],
                mcpServers: { agents: innerMcpServer },
                hooks: buildSubAgentHooks(
                  cwd,
                  additionalDirectories,
                  allAgents,
                  registry,
                  this.def.manifestKey,
                  this.def.displayName,
                  agentSettings.notifications,
                  { ...process.env, ...agentConfig.extraEnv, DOVEPAW_SUBAGENT: "1" },
                  !!groupOverrides,
                  isAskMode,
                  isDirectChat,
                  effectiveDoveSettings(globalSettings).subAgentBehaviorReminder || undefined,
                  groupOverrides?.groupMomentsPath,
                ),
                abortController: this.abortController ?? undefined,
                ...(canUseTool ? { canUseTool } : {}),
                permissionMode:
                  effectiveDoveSettings(globalSettings).securityMode === "read-only"
                    ? getSecurityModeStrategy("read-only").permissionMode
                    : "acceptEdits",
                includePartialMessages: true,
                settingSources: ["project", "user", "local"],
              },
            }),
            dispatcher,
            (subSessionId) => {
              // system:init fires once per turn (including resume turns).
              // Only create the DB row on the first turn — resuming an existing
              // session must not recreate a row the user may have deleted.
              if (!existingState) {
                SessionManager.save(
                  this.def.name,
                  contextId,
                  { output: "", progress: [] },
                  {
                    label,
                    userText: instruction || "",
                    userMsgId,
                    subagentSessionId: subSessionId,
                    workspacePath: cwd,
                  },
                );
                this.persistence?.setStatus(contextId, "running");
              }
              // Always enable incremental saves — applies to both fresh and resumed turns
              // so onTaskProgress labels are persisted to DB during the session.
              dispatcher.enableIncrementalSave({
                sessionId: contextId,
                agentId: this.def.name,
                label,
                userMsgId,
                userText: instruction || "",
              });
            },
          );

          if (subagentSessionId) {
            this.sessionManager.set(contextId, {
              subagentSessionId,
              workspace: workspace ?? restoreAgentWorkspace(cwd),
              startedAt,
              label,
            });
          }

          const assistantMsg = dispatcher.buildAssistantMessage();

          // Persist session — single source of truth for both modes
          SessionManager.save(
            this.def.name,
            contextId,
            { output: "", progress: dispatcher.buildProgress() },
            {
              label,
              userText: instruction || "",
              userMsgId,
              assistantMsg,
              subagentSessionId: subagentSessionId ?? undefined,
              workspacePath: cwd,
            },
          );

          consola.success(`${this.def.displayName} sub-agent completed`);

          const finalContent = dispatcher.buildFinalContent();
          relaySessionEvent(
            contextId,
            finalContent ? { type: "done", content: finalContent } : { type: "done" },
          );
          publisher.publishStatusToUI("", undefined, "completed");
        },
        (err, isAbort) => {
          if (isAbort) {
            consola.info(`${this.def.displayName} sub-agent cancelled`);
            relaySessionEvent(contextId, { type: "cancelled" });
            publisher.publishStatusToUI("", undefined, "canceled");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            consola.error(`${this.def.displayName} sub-agent failed: ${msg}`);
            relaySessionEvent(contextId, { type: "error", content: msg });
            relaySessionEvent(contextId, { type: "done" });
            publisher.publishStatusToUI("", { error: msg }, "failed");
          }
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      consola.error(`Failed to start ${this.def.displayName} sub-agent:`, err);
      relaySessionEvent(contextId, { type: "error", content: msg });
    } finally {
      this.publisherRegistry?.delete(taskId);
      await Promise.allSettled(backgroundTasks);
      this.abortController?.abort();
      this.abortController = null;
      markIdle(this.def.manifestKey, taskId);
      eventBus.finished();
    }
  }

  async cancelTask(): Promise<void> {
    // STOP must NOT wipe the workspace — that breaks session resume. Workspace
    // cleanup is owned by the explicit DELETE path (POST /session/clear in
    // base-server.ts), invoked only when the user removes the session.
    this.abortController?.abort();
  }
}
