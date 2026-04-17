import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { consola } from "consola";
import type { AgentExecutor, RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import type { AgentDef } from "@@/lib/agents";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { consumeQueryEvents, withMcpQuery } from "@/lib/query-events";
import { A2AQueryDispatcher } from "@/lib/query-dispatcher";
import { upsertProgressEntry, type ProgressEntry } from "@/lib/progress";
import { agentPersistentLogDir, agentPersistentStateDir } from "@/lib/paths";
import { LAUNCH_AGENTS_DIR, agentConfigDir } from "@@/lib/paths";
import { readAgentSettings, readSettings } from "@@/lib/settings";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";
import {
  makeAgentMgmtTools,
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
import { PipelineTrigger } from "./pipeline-trigger";
import { buildSubAgentHooks } from "@/lib/subagent-hooks";
import { PendingRegistry } from "@/lib/pending-registry";
import type { CollectedStream } from "@/lib/a2a-client";
import { createAgentWorkspace } from "./workspace";
import type { AgentWorkspace } from "./workspace";
import { SessionManager, type SessionInfo } from "@/lib/session-manager";
import { setSessionStatus, upsertSession } from "@/lib/db";
import { publishSessionEvent } from "@/lib/session-events";
import { markProcessing, markIdle } from "./processing-registry";
import { ExecutorPublisher } from "./executor-publisher";

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

export { SessionInfo };

export class QueryAgentExecutor implements AgentExecutor {
  private abortController: AbortController | null = null;
  private currentContextId: string | null = null;
  private readonly agentConfigReader = new AgentConfigReader();
  private readonly pipelineTrigger = new PipelineTrigger();

  constructor(
    private readonly def: AgentDef,
    private readonly sessionManager: SessionManager,
  ) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;
    const instruction = extractInstruction(requestContext.userMessage.parts);
    this.abortController = new AbortController();
    markProcessing(this.def.manifestKey, this.abortController, instruction ? "dove" : "scheduled");

    consola.start(`Running ${this.def.displayName} sub-agent…`);

    const publisher = new ExecutorPublisher(eventBus, taskId, contextId);

    // Restore session early so publishProgress can use the correct label from the start.
    // Without this, the first upsertSession call would create the DB row with label:"",
    // and since ON CONFLICT does not update label, it would stay empty in history.
    this.currentContextId = contextId;
    this.sessionManager.restore(contextId, this.def.name);
    const existingState = this.sessionManager.get(contextId);
    const startedAt = existingState?.startedAt ?? new Date();
    const label =
      existingState?.label ??
      (instruction ? instruction.slice(0, LABEL_MAX_LEN) : `Scheduled Session: ${taskId}`);
    let workspace: AgentWorkspace | null = null;
    const userMsgId = randomUUID();
    const backgroundTasks: Promise<CollectedStream>[] = [];

    // Track direct publishStatusToUI calls (workspace setup, clone progress, etc.)
    // so sub-agent history sessions show these entries alongside the tool-call entries
    // already captured by dispatcher.buildProgress().
    const innerProgress: ProgressEntry[] = [];
    const publishProgress = (text: string, artifacts: Record<string, string> = {}): void => {
      publisher.publishStatusToUI(text, artifacts);
      upsertProgressEntry(innerProgress, text, artifacts);
      upsertSession({
        id: contextId,
        agentId: this.def.name,
        startedAt: new Date().toISOString(),
        label,
        messages: [],
        progress: innerProgress,
        status: "running",
      });
    };

    // Publish the Task object first so ResultManager registers it in the TaskStore.
    // Without this, every subsequent event triggers a "unknown task" warning because
    // ResultManager.currentTask is only set when it sees a kind:"task" event.
    publisher.publishTask();

    publishProgress("Starting…");

    const [{ extraEnv, repoSlugs }, agentSettings, globalSettings] = await Promise.all([
      this.agentConfigReader.resolveAgentSettings(this.def.name),
      readAgentSettings(this.def.name),
      readSettings(),
    ]);
    const defaultModel = effectiveDoveSettings(globalSettings).defaultModel.trim();

    try {
      if (existingState) {
        // Resume existing session — reuse workspace and Claude session.
        workspace = existingState.workspace;
      } else {
        // First message in this context — create a fresh workspace.
        workspace = createAgentWorkspace(
          this.def.name,
          this.def.alias,
          undefined,
          taskId,
          publishProgress,
        );
      }

      const agentConfig = buildAgentConfig(this.def, workspace, extraEnv, repoSlugs);
      const agentSourceDir = dirname(agentConfig.scriptPath);

      const registry = new PendingRegistry();

      const chatToTools = await this.agentConfigReader.resolveLinkedTools(
        this.def.name,
        this.abortController.signal,
        backgroundTasks,
        registry,
      );

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
          ),
          makeAwaitScriptTool(this.def, registry),
          ...makeAgentMgmtTools(this.def),
          ...chatToTools,
        ],
        async (innerMcpServer) => {
          const additionalDirectories = [
            LAUNCH_AGENTS_DIR,
            agentPersistentLogDir(this.def.name),
            agentPersistentStateDir(this.def.name),
            agentConfigDir(this.def.name),
            agentSourceDir,
          ];
          const dispatcher = new A2AQueryDispatcher(publisher, contextId);
          const subagentSessionId = await consumeQueryEvents(
            query({
              prompt: instruction || startRunScriptToolName(this.def.manifestKey),
              options: {
                cwd: workspace!.path,
                env: { ...process.env, ...agentConfig.extraEnv },
                ...(defaultModel ? { model: defaultModel } : {}),
                agent: this.def.displayName,
                ...(existingState ? { resume: existingState.subagentSessionId } : {}),
                systemPrompt: {
                  type: "preset",
                  preset: "claude_code",
                  append: buildSubAgentPrompt(this.def),
                },
                additionalDirectories,
                allowedTools: [
                  `mcp__agents__${startRunScriptToolName(this.def.manifestKey)}`,
                  `mcp__agents__${awaitRunScriptToolName(this.def.manifestKey)}`,
                  ...Object.values(MGMT_TOOL).map((n) => `mcp__agents__${n}`),
                  ...chatToTools.map((t) => `mcp__agents__${t.name}`),
                ],
                mcpServers: { agents: innerMcpServer },
                hooks: buildSubAgentHooks(
                  workspace!.path,
                  additionalDirectories,
                  chatToTools,
                  registry,
                  this.def.manifestKey,
                  this.def.displayName,
                  agentSettings.notifications,
                  { ...process.env, ...agentConfig.extraEnv },
                ),
                abortController: this.abortController ?? undefined,
                permissionMode: "acceptEdits",
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
                    workspacePath: workspace?.path,
                  },
                );
                setSessionStatus(contextId, "running");
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
              workspace: workspace!,
              startedAt,
              label,
            });
          }

          // Persist session with clean message: text-only segments, thinking → processContent.
          // Runs for both Dove-triggered and direct subagent-chat requests — single source of truth.
          // subagentSessionId and workspacePath are persisted so the session can be restored after
          // a server restart when the user reopens a historical Dove conversation.
          SessionManager.save(
            this.def.name,
            contextId,
            { output: "", progress: dispatcher.buildProgress() },
            {
              label,
              userText: instruction || "",
              userMsgId,
              assistantMsg: dispatcher.buildAssistantMessage(),
              subagentSessionId: subagentSessionId ?? undefined,
              workspacePath: workspace?.path,
            },
          );

          consola.success(`${this.def.displayName} sub-agent completed`);

          // Pipeline: hand off to PipelineTrigger — it owns target resolution and stream firing
          const finalOutput = dispatcher
            .buildAssistantMessage()
            .segments.filter((s): s is Extract<typeof s, { type: "text" }> => s.type === "text")
            .map((s) => s.content)
            .join("\n")
            .trim();
          void this.pipelineTrigger.fire(this.def.name, finalOutput);

          publishSessionEvent(contextId, { type: "done" });
          publisher.publishStatusToUI("", undefined, "completed");
        },
        (err, isAbort) => {
          if (isAbort) {
            consola.info(`${this.def.displayName} sub-agent cancelled`);
            publishSessionEvent(contextId, { type: "cancelled" });
            publisher.publishStatusToUI("", undefined, "canceled");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            consola.error(`${this.def.displayName} sub-agent failed: ${msg}`);
            publishSessionEvent(contextId, { type: "error", content: msg });
            publishSessionEvent(contextId, { type: "done" });
            publisher.publishStatusToUI("", { error: msg }, "failed");
          }
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      consola.error(`Failed to start ${this.def.displayName} sub-agent:`, err);
      publishSessionEvent(contextId, { type: "error", content: msg });
    } finally {
      await Promise.allSettled(backgroundTasks);
      this.abortController?.abort();
      this.abortController = null;
      markIdle(this.def.manifestKey);
      eventBus.finished();
    }
  }

  async cancelTask(): Promise<void> {
    this.abortController?.abort();
    if (this.currentContextId) this.sessionManager.delete(this.currentContextId);
  }
}
