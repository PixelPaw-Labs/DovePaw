import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  installAgent,
  uninstallAgent,
  loadAgent,
  unloadAgent,
  isLoaded,
  getAgentStatus,
  getAgentLogs,
} from "@/lib/agent-scheduler";
import { cancelProcessing } from "@/a2a/lib/processing-registry";
import type { AgentDef } from "@@/lib/agents";
import { scheduler } from "@@/lib/scheduler";
import { z } from "zod";

// ─── Management tool names ─────────────────────────────────────────────────────

export const MGMT_TOOL = {
  install: "install_agent",
  uninstall: "uninstall_agent",
  load: "load_agent",
  unload: "unload_agent",
  status: "check_status",
  logs: "get_logs",
} as const;

// ─── Management tools factory ─────────────────────────────────────────────────

/** Returns the 6 per-agent scheduler management tools for use in an inner MCP server. */
export function makeAgentMgmtTools(agent: AgentDef) {
  const installTool = tool(
    MGMT_TOOL.install,
    `Build and install only the ${agent.displayName} agent (scoped tsup build → deploy script → write scheduler config → activate)`,
    {},
    async () => {
      const { loaded, skipped } = await installAgent(agent);
      if (skipped) {
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ ${agent.displayName} is not scheduling-enabled — scheduler install skipped.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: loaded
              ? `✅ ${agent.displayName} installed and active.`
              : `⚠️ ${agent.displayName} config written but not showing as active — check scheduler.`,
          },
        ],
      };
    },
  );

  const uninstallTool = tool(
    MGMT_TOOL.uninstall,
    `Deactivate and remove only the ${agent.displayName} scheduler config`,
    {},
    async () => {
      cancelProcessing(agent.manifestKey);
      await uninstallAgent(agent);
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ ${agent.displayName} deactivated and config removed.`,
          },
        ],
      };
    },
  );

  const loadTool = tool(
    MGMT_TOOL.load,
    `Activate the ${agent.displayName} scheduler entry`,
    {},
    async () => {
      await loadAgent(agent);
      const loaded = await isLoaded(scheduler.agentLabel(agent));
      return {
        content: [
          {
            type: "text" as const,
            text: loaded
              ? `✅ ${agent.displayName} activated.`
              : `⚠️ ${agent.displayName} activation attempted but not showing as active.`,
          },
        ],
      };
    },
  );

  const unloadTool = tool(
    MGMT_TOOL.unload,
    `Deactivate the ${agent.displayName} scheduler entry`,
    {},
    async () => {
      cancelProcessing(agent.manifestKey);
      await unloadAgent(agent);
      return {
        content: [{ type: "text" as const, text: `✅ ${agent.displayName} deactivated.` }],
      };
    },
  );

  const checkStatusTool = tool(
    MGMT_TOOL.status,
    `Get scheduler state, PID, last exit code, and active status for ${agent.displayName}`,
    {},
    async () => {
      const [{ state, pid, lastExitCode, raw }, loaded] = await Promise.all([
        getAgentStatus(agent),
        isLoaded(scheduler.agentLabel(agent)),
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
      const output = await getAgentLogs(agent, lines);
      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  return [installTool, uninstallTool, loadTool, unloadTool, checkStatusTool, getLogsTool];
}
