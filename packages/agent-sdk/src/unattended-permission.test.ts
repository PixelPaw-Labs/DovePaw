import type { McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { createUnattendedPermissionAnswer } from "./unattended-permission.js";

type CanUseTool = ReturnType<typeof createUnattendedPermissionAnswer>;
type CanUseToolOptions = Parameters<CanUseTool>[2];

function makeOptions(overrides: Partial<CanUseToolOptions> = {}): CanUseToolOptions {
  return {
    signal: new AbortController().signal,
    toolUseID: "toolu_test",
    requestId: "req_test",
    ...overrides,
  };
}

const slackServer: McpServerStatus = {
  name: "claude.ai Slack",
  status: "connected",
  tools: [
    { name: "slack_read_channel", annotations: { readOnly: true, openWorld: true } },
    { name: "slack_send_message", annotations: { openWorld: true } },
    { name: "slack_update_canvas", annotations: { readOnly: true, destructive: true } },
    { name: "slack_search_emojis" },
  ],
};

const slackAsk = (overrides: Partial<CanUseToolOptions> = {}) =>
  makeOptions({
    mcpServer: { name: "claude.ai Slack", source: "claudeai" },
    decisionReason: "Slack tool needs approval",
    ...overrides,
  });

const slackDeny = { behavior: "deny", message: "Slack tool needs approval" };

describe("createUnattendedPermissionAnswer", () => {
  const noServers = async (): Promise<McpServerStatus[]> => [];

  describe("add-on approval asks", () => {
    const answer = createUnattendedPermissionAnswer(noServers);
    const input = { skill: "stop-slop" };

    it("allows an add-on approval ask with the original input", async () => {
      const result = await answer(
        "Skill",
        input,
        makeOptions({ decisionReason: "skill stop-slop has never been approved on this laptop" }),
      );
      expect(result).toEqual({ behavior: "allow", updatedInput: input });
    });

    it("denies an add-on approval ask forced by a user ask rule", async () => {
      const result = await answer(
        "Skill",
        input,
        makeOptions({
          decisionReason: "skill stop-slop has never been approved on this laptop",
          matchedAskRule: { source: "userSettings", toolName: "Skill" },
        }),
      );
      expect(result).toEqual({
        behavior: "deny",
        message: "skill stop-slop has never been approved on this laptop",
      });
    });

    it("denies any other ask with its reason", async () => {
      const result = await answer(
        "Bash",
        { command: "rm -rf /tmp/x" },
        makeOptions({ decisionReason: "Bash command needs approval" }),
      );
      expect(result).toEqual({ behavior: "deny", message: "Bash command needs approval" });
    });

    it("denies an ask with no reason", async () => {
      const result = await answer("Write", {}, makeOptions());
      expect(result).toEqual({
        behavior: "deny",
        message: "Nobody is available to approve this tool call",
      });
    });
  });

  describe("MCP tools", () => {
    const input = { channel_id: "C123" };

    it("allows a tool its server marks read-only", async () => {
      const answer = createUnattendedPermissionAnswer(async () => [slackServer]);
      const result = await answer("mcp__claude_ai_Slack__slack_read_channel", input, slackAsk());
      expect(result).toEqual({ behavior: "allow", updatedInput: input });
    });

    it("denies a tool its server does not mark read-only", async () => {
      const answer = createUnattendedPermissionAnswer(async () => [slackServer]);
      const result = await answer("mcp__claude_ai_Slack__slack_send_message", input, slackAsk());
      expect(result).toEqual(slackDeny);
    });

    it("denies a tool with no annotations", async () => {
      const answer = createUnattendedPermissionAnswer(async () => [slackServer]);
      const result = await answer("mcp__claude_ai_Slack__slack_search_emojis", input, slackAsk());
      expect(result).toEqual(slackDeny);
    });

    it("denies a read-only tool that is also marked destructive", async () => {
      const answer = createUnattendedPermissionAnswer(async () => [slackServer]);
      const result = await answer("mcp__claude_ai_Slack__slack_update_canvas", input, slackAsk());
      expect(result).toEqual(slackDeny);
    });

    it("denies a read-only tool forced by a user ask rule", async () => {
      const answer = createUnattendedPermissionAnswer(async () => [slackServer]);
      const result = await answer(
        "mcp__claude_ai_Slack__slack_read_channel",
        input,
        slackAsk({
          matchedAskRule: {
            source: "userSettings",
            toolName: "mcp__claude_ai_Slack__slack_read_channel",
          },
        }),
      );
      expect(result).toEqual(slackDeny);
    });

    it("denies when the ask carries no MCP server", async () => {
      const answer = createUnattendedPermissionAnswer(async () => [slackServer]);
      const result = await answer(
        "mcp__claude_ai_Slack__slack_read_channel",
        input,
        makeOptions({ decisionReason: "Slack tool needs approval" }),
      );
      expect(result).toEqual(slackDeny);
    });

    it("does not trust a same-named tool on a different server", async () => {
      const answer = createUnattendedPermissionAnswer(async () => [slackServer]);
      const result = await answer(
        "mcp__other__slack_read_channel",
        input,
        slackAsk({ mcpServer: { name: "other", source: "user" } }),
      );
      expect(result).toEqual(slackDeny);
    });

    it("reuses the server list across asks", async () => {
      const listMcpServers = vi.fn(async () => [slackServer]);
      const answer = createUnattendedPermissionAnswer(listMcpServers);
      await answer("mcp__claude_ai_Slack__slack_read_channel", input, slackAsk());
      await answer("mcp__claude_ai_Slack__slack_read_channel", input, slackAsk());
      expect(listMcpServers).toHaveBeenCalledTimes(1);
    });

    it("looks the servers up again when a tool is not in the cached list", async () => {
      const listMcpServers = vi
        .fn<() => Promise<McpServerStatus[]>>()
        .mockResolvedValueOnce([{ name: "claude.ai Slack", status: "pending" }])
        .mockResolvedValueOnce([slackServer]);
      const answer = createUnattendedPermissionAnswer(listMcpServers);
      const result = await answer("mcp__claude_ai_Slack__slack_read_channel", input, slackAsk());
      expect(result).toEqual({ behavior: "allow", updatedInput: input });
      expect(listMcpServers).toHaveBeenCalledTimes(2);
    });

    it("denies with the original reason when the server lookup fails, and retries next time", async () => {
      const listMcpServers = vi
        .fn<() => Promise<McpServerStatus[]>>()
        .mockRejectedValueOnce(new Error("control channel closed"))
        .mockResolvedValueOnce([slackServer]);
      const answer = createUnattendedPermissionAnswer(listMcpServers);
      const first = await answer("mcp__claude_ai_Slack__slack_read_channel", input, slackAsk());
      expect(first).toEqual(slackDeny);
      const second = await answer("mcp__claude_ai_Slack__slack_read_channel", input, slackAsk());
      expect(second).toEqual({ behavior: "allow", updatedInput: input });
    });
  });
});
