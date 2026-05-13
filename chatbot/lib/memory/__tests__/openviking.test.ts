import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { TMP_OV_ROOT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  return { TMP_OV_ROOT: fs.mkdtempSync(path.join(os.tmpdir(), "dovepaw-ovtest-")) };
});

vi.mock("@@/lib/paths", async () => {
  const actual = await vi.importActual<typeof import("@@/lib/paths")>("@@/lib/paths");
  return {
    ...actual,
    OPENVIKING_CONFIG_DIR: TMP_OV_ROOT,
    OPENVIKING_SERVER_CONFIG: join(TMP_OV_ROOT, "ov.conf"),
    OPENVIKING_CLI_CONFIG: join(TMP_OV_ROOT, "ovcli.conf"),
    OPENVIKING_DATA_DIR: join(TMP_OV_ROOT, "data"),
  };
});

import { OpenVikingMemoryProvider } from "@/lib/memory/openviking";

describe("OpenVikingMemoryProvider.boot — config preflight", () => {
  function writeConfig(config: object): void {
    writeFileSync(join(TMP_OV_ROOT, "ov.conf"), JSON.stringify(config));
  }

  it("rejects fast when ov.conf is missing embedding.dense.provider", async () => {
    writeConfig({
      server: { root_api_key: "k" },
      storage: { workspace: "/tmp" },
      vlm: { provider: "openai-codex" },
    });
    await expect(OpenVikingMemoryProvider.boot(0)).rejects.toThrow(/embedding\.dense\.provider/);
  });

  it("rejects fast when ov.conf is missing vlm.provider", async () => {
    writeConfig({
      server: { root_api_key: "k" },
      storage: { workspace: "/tmp" },
      embedding: { dense: { provider: "openai" } },
    });
    await expect(OpenVikingMemoryProvider.boot(0)).rejects.toThrow(/vlm\.provider/);
  });
});

describe("OpenVikingMemoryProvider.boot — dev-mode config", () => {
  function configPath(): string {
    return join(TMP_OV_ROOT, "ov.conf");
  }

  it("writes auth_mode=dev and no root_api_key for a fresh config", async () => {
    if (existsSync(configPath())) rmSync(configPath());
    // Fresh boot path will write defaults; spawn still fails in tests.
    await expect(OpenVikingMemoryProvider.boot(0)).rejects.toThrow();
    expect(existsSync(configPath())).toBe(true);
    const written = JSON.parse(readFileSync(configPath(), "utf-8")) as {
      server: { auth_mode?: string; root_api_key?: string };
    };
    expect(written.server.auth_mode).toBe("dev");
    expect(written.server.root_api_key).toBeUndefined();
  });
});

describe("OpenVikingMemoryProvider.buildReminder", () => {
  const provider = new OpenVikingMemoryProvider(51234);

  it("emits HTTP API curl commands pointing at the live sidecar port", () => {
    const body = provider.buildReminder("/ws/x", "grp-xyz");
    expect(body).toContain("http://localhost:51234");
    expect(body).toContain("/api/v1/search/find");
    expect(body).toContain("/api/v1/sessions");
    expect(body).toContain("X-OpenViking-Agent: grp-xyz");
    // CLI commands should be gone — agents hit the HTTP API directly so they
    // don't depend on OPENVIKING_CLI_CONFIG_FILE being set in their shell.
    expect(body).not.toContain("ov find");
    expect(body).not.toContain("ov add-memory");
    expect(body).not.toContain("ov add-resource");
  });

  it("includes the roster bullet and writing pattern", () => {
    const body = provider.buildReminder("/ws/x", "grp-xyz");
    expect(body).toContain("/ws/x/members/roster.md");
    expect(body).toContain("All substance stays. Only fluff dies.");
  });
});

describe("OpenVikingMemoryProvider.deleteGroup", () => {
  it("resolves without throwing even if the ov binary or sidecar is unreachable", async () => {
    // No live sidecar in tests — the shell-out should fail silently rather
    // than propagate, matching the "idempotent, best-effort" contract.
    const provider = new OpenVikingMemoryProvider(1);
    await expect(provider.deleteGroup("grp-xyz", "/tmp")).resolves.toBeUndefined();
  });
});
