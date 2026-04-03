import { join } from "node:path";
import { consola } from "consola";
import type { AgentExecutor, RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import type { AgentDef } from "@@/lib/agents";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { consumeQueryEvents, withMcpQuery } from "@/lib/query-events";
import { A2AQueryDispatcher } from "@/lib/query-dispatcher";
import { AGENTS_ROOT, agentPersistentLogDir, agentPersistentStateDir } from "@/lib/paths";
import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
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
import { createAgentWorkspace, agentSourceDirFromEntry } from "./workspace";
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
export class QueryAgentExecutor implements AgentExecutor {
  private abortController: AbortController | null = null;

  constructor(private readonly def: AgentDef) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;
    const instruction = extractInstruction(requestContext.userMessage.parts);
    this.abortController = new AbortController();
    markProcessing(this.def.manifestKey, this.abortController, instruction ? "dove" : "scheduled");

    consola.start(`Running ${this.def.displayName} sub-agent…`);

    const publisher = new ExecutorPublisher(eventBus, taskId, contextId);

    // Publish the Task object first so ResultManager registers it in the TaskStore.
    // Without this, every subsequent event triggers a "unknown task" warning because
    // ResultManager.currentTask is only set when it sees a kind:"task" event.
    publisher.publishTask();

    publisher.publishStatusToUI("Starting…");

    // Resolve env vars fresh on each execution so settings changes take effect
    const settings = readSettings();
    const agentSettings = readAgentSettings(this.def.name);
    const extraEnv = resolveSettingsEnv(settings, agentSettings.envVars);

    // Resolve selected repos to GitHub slugs for cloning and REPO_LIST injection
    const repoSlugs = agentSettings.repos
      .map((id) => settings.repositories.find((r) => r.id === id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => r.githubRepo);

    // Workspace, repo cloning, and query() are all inside the outer try so
    // the finally block always runs cleanup regardless of where a failure occurs.
    let workspace: Awaited<ReturnType<typeof createAgentWorkspace>> | null = null;
    let exitHandler: (() => void) | null = null;

    try {
      // Create an isolated workspace for this entire execution — used as cwd for
      // both the query() sub-agent and the agent script spawned by run_script.
      workspace = createAgentWorkspace(
        this.def.name,
        this.def.alias,
        agentSourceDirFromEntry(this.def.entryPath),
        undefined,
        taskId,
        (text, artifacts) => publisher.publishStatusToUI(text, artifacts),
      );

      // Guard against process.exit() bypassing the finally block — each executor
      // is only responsible for its own workspace, not others.
      exitHandler = () => workspace?.cleanup();
      process.once("exit", exitHandler);

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
            (message, artifacts) => publisher.publishStatusToUI(message, artifacts),
          ),
          makeAwaitScriptTool(this.def),
          ...makeAgentMgmtTools(this.def),
        ],
        async (innerMcpServer) => {
          await consumeQueryEvents(
            query({
              prompt: instruction || START_SCRIPT_TOOL,
              options: {
                cwd: workspace!.path,
                env: { ...process.env, ...agentConfig.extraEnv },
                agent: this.def.displayName,
                systemPrompt: {
                  type: "preset",
                  preset: "claude_code",
                  append: buildSubAgentPrompt(this.def),
                },
                additionalDirectories: [
                  LAUNCH_AGENTS_DIR,
                  agentPersistentLogDir(this.def.name),
                  agentPersistentStateDir(this.def.name),
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
                settingSources: ["project", "user"],
              },
            }),
            new A2AQueryDispatcher(publisher),
          );

          consola.success(`${this.def.displayName} sub-agent completed`);
          publisher.publishStatusToUI("", undefined, "completed");
        },
        (err, isAbort) => {
          if (isAbort) {
            consola.info(`${this.def.displayName} sub-agent cancelled`);
            publisher.publishStatusToUI("", undefined, "canceled");
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            consola.error(`${this.def.displayName} sub-agent failed: ${msg}`);
            publisher.publishStatusToUI("", { error: msg }, "failed");
          }
        },
      );
    } finally {
      this.abortController?.abort();
      // Remove the exit handler before calling cleanup() to avoid firing twice.
      if (exitHandler) process.off("exit", exitHandler);
      workspace?.cleanup();
      this.abortController = null;
      markIdle(this.def.manifestKey);
      eventBus.finished();
    }
  }

  async cancelTask(): Promise<void> {
    this.abortController?.abort();
  }
}
