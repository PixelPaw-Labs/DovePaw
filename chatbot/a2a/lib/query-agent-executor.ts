import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { consola } from "consola";
import type { AgentExecutor, RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import type { AgentDef } from "@@/lib/agents";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { consumeQueryEvents, withMcpQuery } from "@/lib/query-events";
import { A2AQueryDispatcher } from "@/lib/query-dispatcher";
import { upsertProgressEntry, type ProgressEntry } from "@/lib/progress";
import { AGENTS_ROOT, agentPersistentLogDir, agentPersistentStateDir } from "@/lib/paths";
import { LAUNCH_AGENTS_DIR, agentConfigDir } from "@@/lib/paths";
import { readSettings, readAgentSettings } from "@@/lib/settings";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import {
  makeAgentMgmtTools,
  makeStartScriptTool,
  makeAwaitScriptTool,
  buildSubAgentPrompt,
  MGMT_TOOL,
  START_SCRIPT_TOOL,
  AWAIT_SCRIPT_TOOL,
} from "@/lib/agent-tools";
import { extractInstruction, type AgentConfig } from "./spawn";
import { buildSubAgentHooks } from "@/lib/hooks";
import {
  createAgentWorkspace,
  agentSourceDirFromEntry,
  ensureAgentSourceSymlink,
} from "./workspace";
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
    this.sessionManager.restore(contextId);
    const existingState = this.sessionManager.get(contextId);
    const startedAt = existingState?.startedAt ?? new Date();
    const label =
      existingState?.label ??
      (instruction ? instruction.slice(0, LABEL_MAX_LEN) : `Scheduled Session: ${taskId}`);
    let workspace: AgentWorkspace | null = null;
    const userMsgId = randomUUID();

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

    // Resolve env vars fresh on each execution so settings changes take effect
    const settings = readSettings();
    const agentSettings = await readAgentSettings(this.def.name);
    const extraEnv = resolveSettingsEnv(settings, agentSettings.envVars);

    // Resolve selected repos to GitHub slugs for cloning and REPO_LIST injection
    const repoSlugs = agentSettings.repos
      .map((id) => settings.repositories.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => r.githubRepo);

    try {
      if (existingState) {
        // Resume existing session — reuse workspace and Claude session.
        workspace = existingState.workspace;
      } else {
        // First message in this context — create a fresh workspace.
        ensureAgentSourceSymlink(
          this.def.name,
          agentSourceDirFromEntry(this.def.entryPath),
          publishProgress,
        );
        workspace = createAgentWorkspace(
          this.def.name,
          this.def.alias,
          undefined,
          taskId,
          publishProgress,
        );
      }

      const workspaceEnv: Record<string, string> = {
        ...extraEnv,
        AGENT_WORKSPACE: workspace.path,
        ...(repoSlugs.length > 0 ? { REPO_LIST: repoSlugs.join(",") } : {}),
      };

      const agentConfig: AgentConfig = {
        scriptPath: join(AGENTS_ROOT, this.def.entryPath),
        agentName: this.def.displayName,
        whatItDoes: this.def.description,
        workspacePath: workspace.path,
        extraEnv: workspaceEnv,
      };

      await withMcpQuery(
        [
          makeStartScriptTool(
            this.def,
            agentConfig,
            repoSlugs,
            this.abortController.signal,
            publishProgress,
            taskId,
          ),
          makeAwaitScriptTool(this.def),
          ...makeAgentMgmtTools(this.def),
        ],
        async (innerMcpServer) => {
          const dispatcher = new A2AQueryDispatcher(publisher, contextId);
          const subagentSessionId = await consumeQueryEvents(
            query({
              prompt: instruction || START_SCRIPT_TOOL,
              options: {
                cwd: workspace!.path,
                env: { ...process.env, ...agentConfig.extraEnv },
                agent: this.def.displayName,
                ...(existingState ? { resume: existingState.subagentSessionId } : {}),
                systemPrompt: {
                  type: "preset",
                  preset: "claude_code",
                  append: buildSubAgentPrompt(this.def),
                },
                additionalDirectories: [
                  LAUNCH_AGENTS_DIR,
                  agentPersistentLogDir(this.def.name),
                  agentPersistentStateDir(this.def.name),
                  agentConfigDir(this.def.name),
                ],
                allowedTools: [
                  `mcp__agents__${START_SCRIPT_TOOL}`,
                  `mcp__agents__${AWAIT_SCRIPT_TOOL}`,
                  ...Object.values(MGMT_TOOL).map((n) => `mcp__agents__${n}`),
                ],
                mcpServers: { agents: innerMcpServer },
                hooks: buildSubAgentHooks(),
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
    } finally {
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
