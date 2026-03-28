import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  worktreePath,
  buildForgePrompt,
  buildMergePrompt,
  buildVerifyPrompt,
  buildPrPrompt,
  AUTONOMY_PREFIX,
} from "./prompts.js";

void describe("worktreePath", () => {
  void it("returns .claude/worktrees/<slug> under repo root", () => {
    assert.equal(
      worktreePath("/path/to/repo", "ec-123-repo"),
      "/path/to/repo/.claude/worktrees/ec-123-repo",
    );
  });
});

void describe("buildForgePrompt", () => {
  void it("includes ticket key and URL", () => {
    const result = buildForgePrompt("EC-123", "https://jira/EC-123", "", "moderate");
    assert.ok(result.includes("[GSD: forge EC-123]"));
    assert.ok(result.includes("https://jira/EC-123"));
  });

  void it("appends dev server info when provided", () => {
    const devInfo = '{"urls": ["http://localhost:3000", "http://localhost:3500"]}';
    const result = buildForgePrompt("EC-1", "url", devInfo, "moderate");
    assert.ok(result.includes("Dev servers are already running:"));
    assert.ok(result.includes(devInfo));
  });

  void it("omits dev server context when empty", () => {
    const result = buildForgePrompt("EC-1", "url", "", "moderate");
    assert.ok(!result.includes("Dev servers are already running"));
  });

  void it("includes autonomy prefix", () => {
    const result = buildForgePrompt("EC-1", "url", "", "moderate");
    assert.ok(result.includes(AUTONOMY_PREFIX));
  });
});

void describe("buildMergePrompt", () => {
  const wtPaths = ["/wt/ec-1", "/wt/ec-2"];

  void it("includes primary ticket in merge branch name", () => {
    const result = buildMergePrompt("EC-1", wtPaths);
    assert.ok(result.includes('"EC-1-merge-{slug}"'));
  });

  void it("lists worktree paths", () => {
    const result = buildMergePrompt("EC-1", wtPaths);
    assert.ok(result.includes("/wt/ec-1"));
    assert.ok(result.includes("/wt/ec-2"));
  });
});

void describe("buildVerifyPrompt", () => {
  void it("includes dev URL and merge branch", () => {
    const result = buildVerifyPrompt("EC-1", "https://dev.example.com", "EC-1-merge", {
      required: true,
      reason: "updates login page",
    });
    assert.ok(result.includes("https://dev.example.com"));
    assert.ok(result.includes("verification"));
    assert.ok(result.includes('merge branch "EC-1-merge"'));
  });

  void it("uses affected URLs instead of root dev URL when provided", () => {
    const result = buildVerifyPrompt(
      "EC-1",
      "http://dev:3000",
      "EC-1-merge",
      {
        required: true,
        reason: "updates login page",
      },
      ["http://dev:3000/team/settings", "http://dev:3000/account"],
    );
    assert.ok(result.includes("http://dev:3000/team/settings"));
    assert.ok(result.includes("http://dev:3000/account"));
    // The verification skill call should use affected URLs, not root
    assert.ok(
      result.includes("/verification http://dev:3000/team/settings http://dev:3000/account"),
    );
  });

  void it("falls back to root dev URL when no affected URLs", () => {
    const result = buildVerifyPrompt(
      "EC-1",
      "http://dev:3000",
      "EC-1-merge",
      {
        required: true,
        reason: "updates login page",
      },
      [],
    );
    assert.ok(result.includes("/verification http://dev:3000"));
  });
});

void describe("buildPrPrompt", () => {
  void it("includes ticket keys and merge branch in prompt", () => {
    const result = buildPrPrompt(["EC-1", "EC-2"], "EC-1-merge");
    assert.ok(result.includes("EC-1, EC-2"));
    assert.ok(result.includes('merge branch "EC-1-merge"'));
    assert.ok(result.includes("create-pr"));
  });
});

// buildBootstrapPrompt tests removed — function deleted, servers now start from Node.js directly
