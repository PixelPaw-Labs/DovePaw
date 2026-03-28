/**
 * Shared agent management tools and sub-agent prompt builder.
 *
 * Used by both QueryAgentExecutor (inside the A2A server) and any other
 * context that needs to expose per-agent launchd management as MCP tools.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  installAgent,
  uninstallAgent,
  loadAgent,
  unloadAgent,
  isLoaded,
  getAgentStatus,
  getAgentLogs,
} from "@/lib/launchd";
import type { AgentDef } from "@@/lib/agents";
import { agentEntryPath, agentLogDir, agentStateDir, plistFilePath } from "@/lib/paths";
import { z } from "zod";
import { startScript, awaitScript, type AgentConfig } from "@/a2a/lib/spawn";

// ─── Management tool names ─────────────────────────────────────────────────────

export const MGMT_TOOL = {
  install: "install_agent",
  uninstall: "uninstall_agent",
  load: "load_agent",
  unload: "unload_agent",
  status: "check_status",
  logs: "get_logs",
} as const;

/** Fires the agent script in the background and returns a runId immediately. */
export const START_SCRIPT_TOOL = "start_run_script";
/** Polls a previously started script run; returns output or still_running. */
export const AWAIT_SCRIPT_TOOL = "await_run_script";

// ─── Management tools factory ─────────────────────────────────────────────────

/** Returns the 6 per-agent launchd management tools for use in an inner MCP server. */
export function makeAgentMgmtTools(agent: AgentDef) {
  const installTool = tool(
    MGMT_TOOL.install,
    `Build and install only the ${agent.displayName} agent (scoped tsup build → deploy script → write plist → bootstrap)`,
    {},
    async () => {
      const { loaded } = await installAgent(agent);
      return {
        content: [
          {
            type: "text" as const,
            text: loaded
              ? `✅ ${agent.displayName} installed and loaded.`
              : `⚠️ ${agent.displayName} plist written but not loaded — check launchctl.`,
          },
        ],
      };
    },
  );

  const uninstallTool = tool(
    MGMT_TOOL.uninstall,
    `Unload and delete only the ${agent.displayName} agent plist`,
    {},
    async () => {
      await uninstallAgent(agent);
      return {
        content: [
          { type: "text" as const, text: `✅ ${agent.displayName} unloaded and plist deleted.` },
        ],
      };
    },
  );

  const loadTool = tool(
    MGMT_TOOL.load,
    `Bootstrap (load) the ${agent.displayName} plist into launchd`,
    {},
    async () => {
      await loadAgent(agent);
      const loaded = await isLoaded(agent.label);
      return {
        content: [
          {
            type: "text" as const,
            text: loaded
              ? `✅ ${agent.displayName} loaded.`
              : `⚠️ ${agent.displayName} bootstrap attempted but not showing as loaded.`,
          },
        ],
      };
    },
  );

  const unloadTool = tool(
    MGMT_TOOL.unload,
    `Bootout (unload) the ${agent.displayName} from launchd`,
    {},
    async () => {
      await unloadAgent(agent);
      return {
        content: [{ type: "text" as const, text: `✅ ${agent.displayName} unloaded.` }],
      };
    },
  );

  const checkStatusTool = tool(
    MGMT_TOOL.status,
    `Get launchd state, PID, last exit code, and loaded status for ${agent.displayName}`,
    {},
    async () => {
      const [{ state, pid, lastExitCode, raw }, loaded] = await Promise.all([
        getAgentStatus(agent),
        isLoaded(agent.label),
      ]);
      const summary = `loaded=${loaded}  state=${state ?? "unknown"}  pid=${pid ?? "-"}  last_exit=${lastExitCode ?? "-"}`;
      return { content: [{ type: "text" as const, text: `${summary}\n\n${raw}` }] };
    },
  );

  const getLogsTool = tool(
    MGMT_TOOL.logs,
    `Read recent log output for ${agent.displayName}`,
    { lines: z.number().optional().describe("Number of lines to return (default 100)") },
    async ({ lines }) => {
      const output = getAgentLogs(agent, lines);
      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  return [installTool, uninstallTool, loadTool, unloadTool, checkStatusTool, getLogsTool];
}

// ─── Script run tools ─────────────────────────────────────────────────────────

/** Fires the agent script in the background and returns a runId immediately. */
export function makeStartScriptTool(agent: AgentDef, config: AgentConfig) {
  return tool(
    START_SCRIPT_TOOL,
    `Start the ${agent.displayName} agent script in the background and return a runId immediately`,
    {
      instruction: z
        .string()
        .optional()
        .describe(`Instruction to pass to the ${agent.displayName} script`),
    },
    async ({ instruction = "run" }) => {
      const { runId } = startScript(config, instruction);
      return {
        content: [{ type: "text" as const, text: `Script started (runId: ${runId})` }],
        structuredContent: { runId },
      };
    },
  );
}

/** Polls a previously started script run; returns output or still_running. */
export function makeAwaitScriptTool(agent: AgentDef) {
  return tool(
    AWAIT_SCRIPT_TOOL,
    `Await a previously started ${agent.displayName} script run. Returns the output when complete, or { status: "still_running", runId } if still in progress.`,
    { runId: z.string().describe("The runId returned by start_run_script") },
    async ({ runId }) => {
      const result = await awaitScript(runId);
      return {
        content: [
          {
            type: "text" as const,
            text:
              result.status === "completed"
                ? result.output
                : result.status === "still_running"
                  ? "Script is still running..."
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
export function buildSubAgentPrompt(agent: AgentDef): string {
  return `You are the ${agent.displayName} sub-agent.

${agent.description}

**When asked about this agent, THOROUGHLY explore and explain:**
- What it does
- What env vars it needs (required: ${agent.requiredEnvVars.length ? agent.requiredEnvVars.join(", ") : "none"})
- What inputs it requires
- What the workflow is
- When it normally runs: ${agent.scheduleDisplay}
- Whether it is already loaded in launchd
- Any other dependencies

**Infer intent before acting — read existing output before running anything:**

This agent produces output (files, logs, state) during its scheduled runs. Before calling the MCP tool, ask yourself: is the user asking about something that has already happened, or do they want to trigger something new?

- References to past or current state ("what did it do", "show me", "tell me about", "what happened", time references like "today's" / "last night's") → look for existing output first; only run if nothing useful is found
- Explicit action words ("run", "trigger", "kick off", "do it now") → call the MCP tool
- Genuinely ambiguous? → ask the user to clarify

**Managing this agent (launchd):**

Label: \`${agent.label}\`
Schedule: ${agent.scheduleDisplay}

You are responsible for installing and uninstalling ONLY yourself (\`${agent.label}\`).
- Install means: build only YOUR TypeScript entry, then load YOUR plist — do not touch other agents.
- Uninstall means: unload YOUR plist and delete it only — do not touch other agents.
- Never install or uninstall any agent other than \`${agent.label}\`.

| Task | Command |
|---|---|
| Install (build + load self) | Call the \`${MGMT_TOOL.install}\` MCP tool |
| Uninstall (unload + delete self) | Call the \`${MGMT_TOOL.uninstall}\` MCP tool |
| Load | Call the \`${MGMT_TOOL.load}\` MCP tool |
| Unload | Call the \`${MGMT_TOOL.unload}\` MCP tool |
| Check status / PID / last exit | Call the \`${MGMT_TOOL.status}\` MCP tool |
| Read logs | Call the \`${MGMT_TOOL.logs}\` MCP tool |
| Show plist content | Read \`~/Library/LaunchAgents/${agent.label}.plist\` using the Read tool |

**Your file boundaries — only access YOUR files, never other agents':**

| Resource | Path |
|---|---|
| Plist | \`${plistFilePath(agent.label)}\` |
| Source | \`${agentEntryPath(agent.entryPath)}\` |
| Logs | \`${agentLogDir(agent.name)}\` |
| State | \`${agentStateDir(agent.name)}\` |

Do NOT read, modify, or reference any files outside these paths.

To run this agent:
1. Call \`${START_SCRIPT_TOOL}\` — returns \`{ runId }\` immediately while the script runs in the background.
2. Call \`${AWAIT_SCRIPT_TOOL}\` with the runId to collect the result — retry with the same runId if it returns \`still_running\`.`;
}
