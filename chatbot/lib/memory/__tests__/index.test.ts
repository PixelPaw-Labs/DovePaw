import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("@@/lib/paths", async () => {
  const actual = await vi.importActual<typeof import("@@/lib/paths")>("@@/lib/paths");
  const tmpRoot = mkdtempSync(join(tmpdir(), "dovepaw-memreg-"));
  return { ...actual, OPENVIKING_PORT_FILE: join(tmpRoot, "openviking-port.json") };
});

import { OPENVIKING_PORT_FILE } from "@@/lib/paths";
import { MarkdownMemoryProvider } from "@/lib/memory/markdown";
import { OpenVikingMemoryProvider } from "@/lib/memory/openviking";
import { getMemoryProvider, setMemoryProvider } from "@/lib/memory";

const portFile = OPENVIKING_PORT_FILE;

describe("memory provider registry", () => {
  beforeEach(() => {
    setMemoryProvider(null);
    if (existsSync(portFile)) rmSync(portFile);
  });

  afterEach(() => {
    setMemoryProvider(null);
    if (existsSync(portFile)) rmSync(portFile);
  });

  it("returns MarkdownMemoryProvider when no override and no port file", async () => {
    expect(await getMemoryProvider()).toBeInstanceOf(MarkdownMemoryProvider);
  });

  it("returns OpenVikingMemoryProvider with the port from disk when the port file exists", async () => {
    writeFileSync(portFile, JSON.stringify({ port: 51234 }));
    const provider = await getMemoryProvider();
    expect(provider).toBeInstanceOf(OpenVikingMemoryProvider);
    expect((provider as OpenVikingMemoryProvider).port).toBe(51234);
  });

  it("setMemoryProvider override wins over disk state", async () => {
    writeFileSync(portFile, JSON.stringify({ port: 51234 }));
    const override = new MarkdownMemoryProvider();
    setMemoryProvider(override);
    expect(await getMemoryProvider()).toBe(override);
  });

  it("setMemoryProvider(null) clears the override and falls back to disk lookup", async () => {
    setMemoryProvider(new MarkdownMemoryProvider());
    writeFileSync(portFile, JSON.stringify({ port: 51234 }));
    setMemoryProvider(null);
    expect(await getMemoryProvider()).toBeInstanceOf(OpenVikingMemoryProvider);
  });

  it("with no override and no port file, the reminder is the .md variant (no ov commands)", async () => {
    const reminder = await (await getMemoryProvider()).buildReadReminder("/ws/x", "grp-1");
    expect(reminder).toContain("/ws/x/moments/");
    expect(reminder).not.toContain("ov find");
    expect(reminder).not.toContain("ov add-resource");
    expect(reminder).not.toContain("viking://agent/");
  });

  it("with port file present, the reminder is the OpenViking script variant", async () => {
    writeFileSync(portFile, JSON.stringify({ port: 51234 }));
    const tmpWs = mkdtempSync(join(tmpdir(), "dovepaw-ov-ws-"));
    try {
      const provider = await getMemoryProvider();
      const reminder = await provider.buildReadReminder(tmpWs, "grp-1");
      expect(reminder).toContain(`bash ${tmpWs}/memory.sh read`);
      expect(reminder).not.toContain("ov find");
      expect(reminder).not.toContain("ov add-memory");
      expect(reminder).not.toContain("moments/");
      const saveReminder = provider.buildSaveReminder(tmpWs);
      expect(saveReminder).toContain(`bash ${tmpWs}/memory.sh save`);
    } finally {
      rmSync(tmpWs, { recursive: true, force: true });
    }
  });
});
