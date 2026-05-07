import { describe, expect, it } from "vitest";
import {
  ALWAYS_DISALLOWED_TOOLS,
  bashHasWriteOperation,
  buildSecurityEnv,
  getSecurityModeStrategy,
} from "./security-policy.js";

describe("getSecurityModeStrategy", () => {
  it("read-only: permissionMode is default (blocks writes at SDK level)", () => {
    const s = getSecurityModeStrategy("read-only");
    expect(s.permissionMode).toBe("default");
    expect(s.readOnly).toBe(true);
    expect(s.allowDangerouslySkipPermissions).toBe(false);
  });

  it("read-only: disallowedTools includes file write and shell write tools", () => {
    const s = getSecurityModeStrategy("read-only");
    expect(s.disallowedTools).toContain("Write");
    expect(s.disallowedTools).toContain("Edit");
    expect(s.disallowedTools).toContain("Bash(rm *)");
    expect(s.disallowedTools).toContain("Bash(mkdir *)");
  });

  it("supervised: permissionMode is acceptEdits, no disallowedTools", () => {
    const s = getSecurityModeStrategy("supervised");
    expect(s.permissionMode).toBe("acceptEdits");
    expect(s.readOnly).toBe(false);
    expect(s.disallowedTools).toHaveLength(0);
  });

  it("autonomous: permissionMode is bypassPermissions, allowDangerouslySkipPermissions true", () => {
    const s = getSecurityModeStrategy("autonomous");
    expect(s.permissionMode).toBe("bypassPermissions");
    expect(s.allowDangerouslySkipPermissions).toBe(true);
    expect(s.readOnly).toBe(false);
    expect(s.disallowedTools).toHaveLength(0);
  });

  it("sub-agent read-only disallowedTools + ALWAYS_DISALLOWED_TOOLS covers write and service tools", () => {
    const modeTools = getSecurityModeStrategy("read-only").disallowedTools;
    const merged = [...modeTools, ...ALWAYS_DISALLOWED_TOOLS];
    expect(merged).toContain("Write");
    expect(merged).toContain("mcp__claude_ai_Gmail_.*");
  });
});

describe("buildSecurityEnv", () => {
  it("read-only: sets DOVEPAW_SECURITY_MODE and DOVEPAW_DISALLOWED_TOOLS", () => {
    const env = buildSecurityEnv("read-only");
    expect(env.DOVEPAW_SECURITY_MODE).toBe("read-only");
    expect(env.DOVEPAW_DISALLOWED_TOOLS).toContain("Write");
    expect(env.DOVEPAW_DISALLOWED_TOOLS).toContain("Edit");
  });

  it("supervised: sets DOVEPAW_SECURITY_MODE, no DOVEPAW_DISALLOWED_TOOLS", () => {
    const env = buildSecurityEnv("supervised");
    expect(env.DOVEPAW_SECURITY_MODE).toBe("supervised");
    expect(env.DOVEPAW_DISALLOWED_TOOLS).toBeUndefined();
  });

  it("autonomous: sets DOVEPAW_SECURITY_MODE, no DOVEPAW_DISALLOWED_TOOLS", () => {
    const env = buildSecurityEnv("autonomous");
    expect(env.DOVEPAW_SECURITY_MODE).toBe("autonomous");
    expect(env.DOVEPAW_DISALLOWED_TOOLS).toBeUndefined();
  });

  it("emits DOVEPAW_ALLOW_WEB_TOOLS=1 when allowWebTools is true", () => {
    const env = buildSecurityEnv("supervised", true);
    expect(env.DOVEPAW_ALLOW_WEB_TOOLS).toBe("1");
  });

  it("does not emit DOVEPAW_ALLOW_WEB_TOOLS when allowWebTools is false", () => {
    const env = buildSecurityEnv("supervised", false);
    expect(env.DOVEPAW_ALLOW_WEB_TOOLS).toBeUndefined();
  });

  it("does not emit DOVEPAW_ALLOW_WEB_TOOLS when allowWebTools is absent", () => {
    const env = buildSecurityEnv("autonomous");
    expect(env.DOVEPAW_ALLOW_WEB_TOOLS).toBeUndefined();
  });
});

describe("ALWAYS_DISALLOWED_TOOLS", () => {
  it("blocks all expected claude.ai MCP service groups", () => {
    const expected = [
      "mcp__claude_ai_Assets_.*",
      "mcp__claude_ai_Gmail_.*",
      "mcp__claude_ai_Google_Calendar_.*",
      "mcp__claude_ai_Google_Drive_.*",
      "mcp__claude_ai_Google_Sheets_.*",
      "mcp__claude_ai_HubSpot_.*",
      "mcp__claude_ai_Jira_.*",
      "mcp__claude_ai_Confluence_.*",
      "mcp__claude_ai_Slack_.*",
      "mcp__claude_ai_Slack_Workato_.*",
      "mcp__claude_ai_Envato_Creative_Companion_.*",
    ];
    for (const pattern of expected) {
      expect(ALWAYS_DISALLOWED_TOOLS).toContain(pattern);
    }
  });
});

describe("bashHasWriteOperation", () => {
  it("detects shell redirect writes", () => {
    expect(bashHasWriteOperation("echo hello > file.txt")).toBe(true);
    expect(bashHasWriteOperation("cat data >> log.txt")).toBe(true);
  });

  it("detects sed in-place edits", () => {
    expect(bashHasWriteOperation("sed -i 's/foo/bar/' file.txt")).toBe(true);
  });

  it("ignores redirects inside quoted strings", () => {
    expect(bashHasWriteOperation('echo "hello > world"')).toBe(false);
    expect(bashHasWriteOperation("echo 'a > b'")).toBe(false);
  });

  it("allows read-only commands", () => {
    expect(bashHasWriteOperation("cat file.txt")).toBe(false);
    expect(bashHasWriteOperation("grep pattern file.txt")).toBe(false);
    expect(bashHasWriteOperation("ls -la")).toBe(false);
  });
});
