import { describe, expect, it, beforeEach } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MarkdownMemoryProvider } from "@/lib/memory/markdown";

describe("MarkdownMemoryProvider", () => {
  let workspace: string;
  const provider = new MarkdownMemoryProvider();

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), "dovepaw-md-mem-"));
  });

  it("initGroup creates a moments/ directory under the group workspace", async () => {
    await provider.initGroup("grp-abc", workspace);
    expect(existsSync(join(workspace, "moments"))).toBe(true);
    await rm(workspace, { recursive: true, force: true });
  });

  it("buildReadReminder includes the moments read path and omits ov commands", () => {
    const body = provider.buildReadReminder("/ws/x", "grp-abc");
    expect(body).toContain("/ws/x/moments/");
    expect(body).not.toContain("ov find");
    expect(body).not.toContain("ov add-resource");
    expect(body).not.toContain("All substance stays. Only fluff dies.");
  });

  it("buildReadReminder uses hard mandatory language for moments read", () => {
    const body = provider.buildReadReminder("/ws/x", "grp-abc");
    expect(body).toContain("MUST");
    expect(body).toContain("hard requirement");
  });

  it("buildSaveReminder includes write path and writing pattern", () => {
    const body = provider.buildSaveReminder("grp-abc", "/ws/x");
    expect(body).toContain("/ws/x/moments/");
    expect(body).toContain("All substance stays. Only fluff dies.");
  });

  it("buildSaveReminder uses hard mandatory language", () => {
    const body = provider.buildSaveReminder("grp-abc", "/ws/x");
    expect(body).toContain("MUST");
    expect(body).toContain("hard requirement");
  });

  it("deleteGroup removes the moments/ subtree", async () => {
    await provider.initGroup("grp-abc", workspace);
    expect(existsSync(join(workspace, "moments"))).toBe(true);
    await provider.deleteGroup("grp-abc", workspace);
    expect(existsSync(join(workspace, "moments"))).toBe(false);
    await rm(workspace, { recursive: true, force: true });
  });

  it("deleteGroup is a no-op when moments/ does not exist", async () => {
    await expect(provider.deleteGroup("grp-abc", workspace)).resolves.toBeUndefined();
    await rm(workspace, { recursive: true, force: true });
  });
});
