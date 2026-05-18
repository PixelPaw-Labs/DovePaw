import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { formatScheduleDisplay } from "@@/lib/agents-config-schemas";
import { scheduler } from "@@/lib/scheduler";
import { agentEntryPath, agentPersistentLogDir, agentPersistentStateDir } from "@/lib/paths";
import { z } from "zod";
import { startScript, awaitScript } from "@/a2a/lib/spawn";
import type { AgentConfig } from "@/a2a/lib/agent-config-builder";
import { recloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import { getMemoryProvider } from "@/lib/memory";
import type { PendingRegistry } from "@/lib/pending-registry";
import { taskRuntime } from "@/lib/task-runtime";
import type { AgentTaskStateMachine } from "@/lib/agent-task-state";
import { MGMT_TOOL } from "./agent-mgmt-tools";

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

// ─── Sub-agent system prompt ───────────────────────────────────────────────────

/** Builds the system prompt appended to the query() sub-agent inside QueryAgentExecutor. */
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
${
  isGroupMode
    ? `
**Group chat mode — response discipline:**

You are contributing to a shared group conversation. When your script completes, respond with your findings directly — no narration about tool execution. Do not say things like "I've kicked off the run", "waiting on output", "the run completed", or any similar status commentary. Deliver your analysis and conclusions only.`
    : ""
}`;
}
