import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { z } from "zod";
import { startScript, awaitScript } from "@/a2a/lib/spawn";
import type { AgentConfig } from "@/a2a/lib/agent-config-builder";
import { recloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import { getMemoryProvider } from "@/lib/memory";
import type { PendingRegistry } from "@/lib/pending-registry";
import { taskRuntime } from "@/lib/task-runtime";
import type { AgentTaskStateMachine } from "@/lib/agent-task-state";

// ─── Script run tool name helpers ─────────────────────────────────────────────

/** Tool name for firing the agent script in the background (start_run_script_* pattern). */
export const startRunScriptToolName = (manifestKey: string): string =>
  `start_script_${manifestKey}`;
/** Tool name for polling a previously started script run (await_run_script_* pattern). */
export const awaitRunScriptToolName = (manifestKey: string): string =>
  `await_script_${manifestKey}`;

// ─── Script run tools ─────────────────────────────────────────────────────────

/** Group-chat overrides passed to makeStartScriptTool when isGroupChat is true. */
export interface GroupChatScriptOverrides {
  /** Group context ID — used as the memory provider's per-group namespace. */
  groupContextId: string;
  /** Shared moments/roster directory path for this group. */
  groupMomentsPath: string;
}

/** Fires the agent script in the background and returns a runId immediately. */
export function makeStartScriptTool(
  agent: AgentDef,
  config: AgentConfig,
  repoSlugs: string[],
  signal?: AbortSignal,
  onProgress?: (message: string, artifacts: Record<string, string>) => void,
  taskId?: string,
  registry?: PendingRegistry,
  /** When set, uses the group workspace path and context ID for the memory read reminder. */
  groupChat?: GroupChatScriptOverrides,
  stateMachine?: AgentTaskStateMachine,
) {
  return tool(
    startRunScriptToolName(agent.manifestKey),
    `Start the ${agent.displayName} agent script in the background and return a runId immediately`,
    {
      instruction: z
        .string()
        .optional()
        .describe(`Instruction to pass to the ${agent.displayName} script`),
    },
    async ({ instruction = "" }) => {
      const provider = await getMemoryProvider();
      const workspacePath = groupChat ? groupChat.groupMomentsPath : config.workspacePath;
      const memoryReminder =
        (groupChat ? provider.rosterReadReminder(workspacePath) + "\n" : "") +
        (await provider.buildReadReminder(
          workspacePath,
          groupChat?.groupContextId ?? taskId ?? "",
        ));
      const clonedPaths = await recloneReposIntoWorkspace(
        config.workspacePath,
        repoSlugs,
        undefined,
        onProgress ? (slug: string) => onProgress(`Cloning`, { repo: slug }) : undefined,
      );
      // Overwrite REPO_LIST with local paths so the agent script can do file I/O.
      // Inject DOVEPAW_TASK_ID so the script can POST progress to the A2A server.
      // Pass the memory reminder via DOVE_MEMORY_REMINDER so the script's
      // argv stays pure JSON and AgentRunner can append it to the system prompt.
      const finalConfig = {
        ...config,
        extraEnv: {
          ...config.extraEnv,
          ...(taskId ? { DOVEPAW_TASK_ID: taskId } : {}),
          ...(clonedPaths.length > 0 ? { REPO_LIST: clonedPaths.join(",") } : {}),
          ...(memoryReminder ? { DOVE_MEMORY_REMINDER: memoryReminder } : {}),
        },
      };
      const { runId } = startScript(finalConfig, instruction, signal, taskId);
      registry?.register({
        awaitTool: awaitRunScriptToolName(agent.manifestKey),
        idKey: "runId",
        id: runId,
      });
      stateMachine?.transition(runId, agent.manifestKey, "running");
      return {
        content: [{ type: "text" as const, text: `Script started (runId: ${runId})` }],
        structuredContent: { runId },
      };
    },
  );
}

/** Polls a previously started script run; returns output or still_running. */
export function makeAwaitScriptTool(
  agent: AgentDef,
  registry?: PendingRegistry,
  stateMachine?: AgentTaskStateMachine,
) {
  return tool(
    awaitRunScriptToolName(agent.manifestKey),
    `Await a previously started ${agent.displayName} script run. Returns the output when complete, or { status: "still_running", runId } if still in progress.`,
    {
      runId: z
        .string()
        .describe(`The runId returned by ${startRunScriptToolName(agent.manifestKey)}`),
      timeoutMs: z
        .number()
        .int()
        .min(10000)
        .describe(
          taskRuntime.buildDescription(agent.name, awaitRunScriptToolName(agent.manifestKey)),
        ),
    },
    async ({ runId, timeoutMs }) => {
      const result = await awaitScript(runId, timeoutMs);
      if (result.status === "completed") {
        taskRuntime.append(
          agent.name,
          awaitRunScriptToolName(agent.manifestKey),
          result.durationMs,
        );
      }
      if (result.status === "completed" || result.status === "not_found") {
        registry?.resolve(runId);
      }
      if (stateMachine) {
        if (result.status === "still_running") {
          stateMachine.transition(runId, agent.manifestKey, "running");
        } else if (result.status === "completed") {
          stateMachine.transition(runId, agent.manifestKey, "completed");
        } else {
          // "not_found"
          stateMachine.transition(runId, agent.manifestKey, "failed");
        }
      }
      return {
        content: [
          {
            type: "text" as const,
            text:
              result.status === "completed"
                ? result.output
                : result.status === "still_running"
                  ? "still_running"
                  : `⚠️ Run \`${runId}\` not found — it may have completed and been cleaned up.`,
          },
        ],
        structuredContent: result,
      };
    },
  );
}

// The sub-agent system prompt lives in `sub-agent.ts`, alongside the query() call it feeds.
