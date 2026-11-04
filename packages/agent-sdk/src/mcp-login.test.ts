import { describe, it, expect, vi } from "vitest";
import {
  ensureMcpLogins,
  mcpServerMatches,
  parseClaudeMcpList,
  parseCodexMcpList,
  readRequiredMcpServers,
  type McpLoginDeps,
  type McpServerState,
} from "./mcp-login.js";

const CLAUDE_LIST = [
  "Checking MCP server health…",
  "",
  "plugin:sumologic:sumo-logic: https://example.mcp.sumologic.com/mcp (HTTP) - ! Needs authentication",
  "buildkite: https://mcp.buildkite.com/mcp (HTTP) - ✔ Connected",
  "claude.ai Google Ads - Testing: Admin Only: https://1.apim.mcp.workato.com - ! Needs authentication",
  "blender: uv --directory /tmp/blender run blender-mcp - ✗ Failed to connect",
].join("\n");

describe("parseClaudeMcpList", () => {
  it("reads each server's name and login state", () => {
    expect(parseClaudeMcpList(CLAUDE_LIST)).toEqual([
      { name: "plugin:sumologic:sumo-logic", status: "needs-auth" },
      { name: "buildkite", status: "connected" },
      { name: "claude.ai Google Ads - Testing: Admin Only", status: "needs-auth" },
      { name: "blender", status: "other" },
    ]);
  });
});

describe("parseCodexMcpList", () => {
  it("treats a stored login as connected and a missing one as needing a login", () => {
    const json = JSON.stringify([
      { name: "sumo-logic", auth_status: "not_logged_in" },
      { name: "buildkite", auth_status: "o_auth" },
      { name: "shadcn", auth_status: "unsupported" },
    ]);
    expect(parseCodexMcpList(json)).toEqual([
      { name: "sumo-logic", status: "needs-auth" },
      { name: "buildkite", status: "connected" },
      { name: "shadcn", status: "connected" },
    ]);
  });
});

describe("mcpServerMatches", () => {
  it("matches the full name or the part after the last colon", () => {
    expect(mcpServerMatches("buildkite", "buildkite")).toBe(true);
    expect(mcpServerMatches("sumo-logic", "plugin:sumologic:sumo-logic")).toBe(true);
    expect(mcpServerMatches("sumologic", "plugin:sumologic:sumo-logic")).toBe(false);
  });
});

describe("readRequiredMcpServers", () => {
  it("splits the comma-separated list and drops blanks", () => {
    expect(
      readRequiredMcpServers({ DOVEPAW_REQUIRED_MCP_SERVERS: " sumo-logic, ,buildkite" }),
    ).toEqual(["sumo-logic", "buildkite"]);
    expect(readRequiredMcpServers({})).toEqual([]);
  });
});

function fakeDeps(rounds: McpServerState[][], start = 0) {
  let clock = start;
  const deps: McpLoginDeps = {
    list: vi.fn(
      async () => rounds[Math.min(vi.mocked(deps.list).mock.calls.length - 1, rounds.length - 1)],
    ),
    login: vi.fn(async () => {
      clock += 60_000;
    }),
    sleep: vi.fn(async () => {}),
    now: () => clock,
  };
  return deps;
}

describe("ensureMcpLogins", () => {
  it("does nothing when no servers are required", async () => {
    const deps = fakeDeps([[]]);
    await ensureMcpLogins({ cli: "claude", servers: [], cwd: "/w" }, deps);
    expect(deps.list).not.toHaveBeenCalled();
  });

  it("returns straight away when every required server is connected", async () => {
    const deps = fakeDeps([[{ name: "buildkite", status: "connected" }]]);
    await ensureMcpLogins({ cli: "claude", servers: ["buildkite"], cwd: "/w" }, deps);
    expect(deps.login).not.toHaveBeenCalled();
  });

  it("logs in to a server that needs it, announces once, and waits until it connects", async () => {
    const needsAuth = { name: "plugin:sumologic:sumo-logic", status: "needs-auth" } as const;
    const deps = fakeDeps([
      [needsAuth],
      [needsAuth],
      [{ name: "plugin:sumologic:sumo-logic", status: "connected" }],
    ]);
    const onWaiting = vi.fn(async () => {});
    await ensureMcpLogins({ cli: "claude", servers: ["sumo-logic"], cwd: "/w", onWaiting }, deps);
    expect(deps.login).toHaveBeenCalledTimes(2);
    expect(deps.login).toHaveBeenCalledWith(
      "claude",
      "plugin:sumologic:sumo-logic",
      "/w",
      expect.any(AbortSignal),
    );
    expect(onWaiting).toHaveBeenCalledOnce();
    expect(onWaiting).toHaveBeenCalledWith("plugin:sumologic:sumo-logic");
  });

  it("ignores servers the agent did not ask for", async () => {
    const deps = fakeDeps([
      [
        { name: "buildkite", status: "connected" },
        { name: "claude.ai Gmail", status: "needs-auth" },
      ],
    ]);
    await ensureMcpLogins({ cli: "claude", servers: ["buildkite"], cwd: "/w" }, deps);
    expect(deps.login).not.toHaveBeenCalled();
  });

  it("fails when a required server is not configured for the CLI", async () => {
    const deps = fakeDeps([[{ name: "buildkite", status: "connected" }]]);
    await expect(
      ensureMcpLogins({ cli: "codex", servers: ["sumo-logic"], cwd: "/w" }, deps),
    ).rejects.toThrow("MCP server not configured for codex: sumo-logic");
  });

  it("gives up once the wait runs out", async () => {
    const deps = fakeDeps([[{ name: "sumo-logic", status: "needs-auth" }]]);
    await expect(
      ensureMcpLogins(
        { cli: "codex", servers: ["sumo-logic"], cwd: "/w", timeoutMs: 120_000 },
        deps,
      ),
    ).rejects.toThrow("Gave up waiting for the sumo-logic MCP login");
    expect(deps.login).toHaveBeenCalledTimes(2);
  });
});
