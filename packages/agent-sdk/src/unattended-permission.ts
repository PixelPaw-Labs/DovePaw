import type { CanUseTool, McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { isAddonApprovalAsk } from "./addon-approval.js";

type McpTool = NonNullable<McpServerStatus["tools"]>[number];

function findMcpTool(
  servers: McpServerStatus[],
  serverName: string,
  toolName: string,
): McpTool | undefined {
  return servers
    .find((server) => server.name === serverName)
    ?.tools?.find((tool) => toolName.endsWith(`__${tool.name}`));
}

function isReadOnly(tool: McpTool | undefined): boolean {
  return tool?.annotations?.readOnly === true && tool.annotations.destructive !== true;
}

export function createUnattendedPermissionAnswer(
  listMcpServers: () => Promise<McpServerStatus[]>,
): CanUseTool {
  let cachedServers: Promise<McpServerStatus[]> | undefined;

  async function isReadOnlyMcpTool(serverName: string, toolName: string): Promise<boolean> {
    try {
      cachedServers ??= listMcpServers();
      const tool = findMcpTool(await cachedServers, serverName, toolName);
      if (tool) return isReadOnly(tool);
      cachedServers = listMcpServers();
      return isReadOnly(findMcpTool(await cachedServers, serverName, toolName));
    } catch {
      cachedServers = undefined;
      return false;
    }
  }

  return async (toolName, input, options) => {
    if (!options.matchedAskRule) {
      if (isAddonApprovalAsk(options.decisionReason)) {
        return { behavior: "allow", updatedInput: input };
      }
      if (options.mcpServer && (await isReadOnlyMcpTool(options.mcpServer.name, toolName))) {
        return { behavior: "allow", updatedInput: input };
      }
    }
    return {
      behavior: "deny",
      message: options.decisionReason ?? "Nobody is available to approve this tool call",
    };
  };
}
