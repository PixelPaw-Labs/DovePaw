import { describe, it, expect } from "vitest";
import {
  ALWAYS_DISALLOWED_TOOLS,
  buildSecurityEnv,
  getSecurityModeStrategy,
  bashHasWriteOperation,
} from "../security-policy.js";

describe("ALWAYS_DISALLOWED_TOOLS", () => {
  it("is a non-empty array of strings", () => {
    expect(Array.isArray(ALWAYS_DISALLOWED_TOOLS)).toBe(true);
    expect(ALWAYS_DISALLOWED_TOOLS.length).toBeGreaterThan(0);
    expect(ALWAYS_DISALLOWED_TOOLS.every((t) => typeof t === "string")).toBe(true);
  });

  it("blocks claude.ai Gmail tools", () => {
    const pattern = ALWAYS_DISALLOWED_TOOLS.find((t) => t.includes("Gmail"));
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!).test("mcp__claude_ai_Gmail__authenticate")).toBe(true);
    expect(new RegExp(pattern!).test("mcp__claude_ai_Gmail_Workato__authenticate")).toBe(true);
  });

  it("blocks claude.ai Jira tools", () => {
    const pattern = ALWAYS_DISALLOWED_TOOLS.find((t) => t.includes("Jira"));
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!).test("mcp__claude_ai_Jira__create_issue")).toBe(true);
  });

  it("blocks claude.ai Slack tools", () => {
    const pattern = ALWAYS_DISALLOWED_TOOLS.find((t) => t.includes("Slack"));
    expect(pattern).toBeDefined();
    expect(new RegExp(pattern!).test("mcp__claude_ai_Slack__authenticate")).toBe(true);
  });
});

describe("buildSecurityEnv", () => {
  it("read-only: sets DOVEPAW_SECURITY_MODE and DOVEPAW_DISALLOWED_TOOLS", () => {
    const env = buildSecurityEnv("read-only");
    expect(env.DOVEPAW_SECURITY_MODE).toBe("read-only");
    expect(env.DOVEPAW_DISALLOWED_TOOLS).toContain("Write");
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
});

describe("getSecurityModeStrategy", () => {
  it("read-only mode uses default permissionMode", () => {
    const s = getSecurityModeStrategy("read-only");
    expect(s.permissionMode).toBe("default");
    expect(s.allowDangerouslySkipPermissions).toBe(false);
  });

  it("supervised mode uses acceptEdits permissionMode", () => {
    const s = getSecurityModeStrategy("supervised");
    expect(s.permissionMode).toBe("acceptEdits");
  });

  it("autonomous mode uses bypassPermissions permissionMode", () => {
    const s = getSecurityModeStrategy("autonomous");
    expect(s.permissionMode).toBe("bypassPermissions");
    expect(s.allowDangerouslySkipPermissions).toBe(true);
  });

  it("read-only mode has non-empty disallowedTools list", () => {
    const s = getSecurityModeStrategy("read-only");
    expect(s.disallowedTools.length).toBeGreaterThan(0);
  });

  it("autonomous mode has empty disallowedTools list", () => {
    const s = getSecurityModeStrategy("autonomous");
    expect(s.disallowedTools).toEqual([]);
  });

  it("sub-agent read-only disallowedTools + ALWAYS_DISALLOWED_TOOLS covers write and service tools", () => {
    const modeTools = getSecurityModeStrategy("read-only").disallowedTools;
    const merged = [...modeTools, ...ALWAYS_DISALLOWED_TOOLS];
    expect(merged).toContain("Write");
    expect(merged.some((t) => t.includes("Gmail"))).toBe(true);
  });
});

describe("bashHasWriteOperation", () => {
  it("detects stdout redirect", () => {
    expect(bashHasWriteOperation("echo hello > file.txt")).toBe(true);
  });

  it("detects append redirect", () => {
    expect(bashHasWriteOperation("echo hello >> file.txt")).toBe(true);
  });

  it("returns false for read-only commands", () => {
    expect(bashHasWriteOperation("cat file.txt")).toBe(false);
    expect(bashHasWriteOperation("ls -la")).toBe(false);
  });
});
