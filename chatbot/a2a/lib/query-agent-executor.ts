import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { consola } from "consola";
import type { AgentExecutor, RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import type { AgentDef } from "@@/lib/agents";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { consumeQueryEvents, withMcpQuery } from "@/lib/query-events";
import { A2AQueryDispatcher } from "@/lib/query-dispatcher";
import { AGENTS_ROOT, agentLogDir, agentStateDir } from "@/lib/paths";
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
import {
  createAgentWorkspace,
  agentSourceDirFromEntry,
  cloneReposIntoWorkspace,
} from "./workspace";
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
export class QueryAgentExecutor implements AgentExecutor {
  private abortController: AbortController | null = null;

  constructor(private readonly def: AgentDef) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;
    const instruction = extractInstruction(requestContext.userMessage.parts);
    this.abortController = new AbortController();
    markProcessing(this.def.manifestKey, this.abortController);

    consola.start(`Running ${this.def.displayName} sub-agent…`);

    // Publish the Task object first so ResultManager registers it in the TaskStore.
    // Without this, every subsequent event triggers a "unknown task" warning because
    // ResultManager.currentTask is only set when it sees a kind:"task" event.
    eventBus.publish({
      kind: "task",
      id: taskId,
      contextId,
      status: { state: "submitted", timestamp: new Date().toISOString() },
      history: [],
    });

    eventBus.publish({
      kind: "status-update",
      taskId,
      contextId,
      status: { state: "working", timestamp: new Date().toISOString() },
      final: false,
    });

    // Resolve env vars fresh on each execution so settings changes take effect
    const agentSettings = readAgentSettings(this.def.name);
    const extraEnv = resolveSettingsEnv(
      this.def.reposEnvVar,
      readSettings(),
      agentSettings.repos,
      agentSettings.envVars,
    );

    // Workspace, repo cloning, and query() are all inside the outer try so
    // the finally block always runs cleanup regardless of where a failure occurs.
    let workspace: Awaited<ReturnType<typeof createAgentWorkspace>> | null = null;

    try {
      // Create an isolated workspace for this entire execution — used as cwd for
      // both the query() sub-agent and the agent script spawned by run_script.
      workspace = createAgentWorkspace(this.def.name, agentSourceDirFromEntry(this.def.entryPath));

      // Clone each assigned repo into the workspace and remap the repos env var
      // from GitHub slugs to local cloned paths.
      const repoSlugs = this.def.reposEnvVar
        ? (extraEnv[this.def.reposEnvVar] ?? "").split(",").filter(Boolean)
        : [];
      const clonedPaths = await cloneReposIntoWorkspace(workspace.path, repoSlugs);

      const workspaceEnv: Record<string, string> = {
        ...extraEnv,
        AGENT_WORKSPACE: workspace.path,
      };
      if (this.def.reposEnvVar && clonedPaths.length > 0) {
        workspaceEnv[this.def.reposEnvVar] = clonedPaths.join(",");
      }

      const agentConfig: AgentConfig = {
        scriptPath: join(AGENTS_ROOT, this.def.entryPath),
        agentName: this.def.displayName,
        whatItDoes: this.def.description,
        workspacePath: workspace.path,
        extraEnv: workspaceEnv,
      };

      await withMcpQuery(
        [
          makeStartScriptTool(this.def, agentConfig, this.abortController.signal),
          makeAwaitScriptTool(this.def),
          ...makeAgentMgmtTools(this.def),
        ],
        async (innerMcpServer) => {
          await consumeQueryEvents(
            query({
              prompt: instruction,
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
                  agentLogDir(this.def.name),
                  agentStateDir(this.def.name),
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
            new A2AQueryDispatcher(eventBus, taskId, contextId),
          );

          consola.success(`${this.def.displayName} sub-agent completed`);
          eventBus.publish({
            kind: "status-update",
            taskId,
            contextId,
            status: { state: "completed", timestamp: new Date().toISOString() },
            final: true,
          });
        },
        (err, isAbort) => {
          if (isAbort) {
            consola.info(`${this.def.displayName} sub-agent cancelled`);
            eventBus.publish({
              kind: "status-update",
              taskId,
              contextId,
              status: { state: "canceled", timestamp: new Date().toISOString() },
              final: true,
            });
          } else {
            const msg = err instanceof Error ? err.message : String(err);
            consola.error(`${this.def.displayName} sub-agent failed: ${msg}`);
            eventBus.publish({
              kind: "artifact-update",
              taskId,
              contextId,
              artifact: {
                artifactId: randomUUID(),
                name: "error",
                parts: [{ kind: "text", text: `Error: ${msg}` }],
              },
            });
            eventBus.publish({
              kind: "status-update",
              taskId,
              contextId,
              status: { state: "failed", timestamp: new Date().toISOString() },
              final: true,
            });
          }
        },
      );
    } finally {
      this.abortController?.abort();
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
