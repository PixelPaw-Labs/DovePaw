import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";

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

describe("OpenVikingMemoryProvider.buildReadReminder", () => {
  const provider = new OpenVikingMemoryProvider(51234);
  const ws = join(TMP_OV_ROOT, "read-reminder-ws");

  beforeAll(() => {
    mkdirSync(ws, { recursive: true });
  });

  it("writes memory.sh that reads port dynamically from port file", async () => {
    await provider.buildReadReminder(ws, "grp-xyz");
    const script = readFileSync(join(ws, "memory.sh"), "utf8");
    expect(script).toContain(".openviking-port.json");
    expect(script).not.toContain("http://localhost:51234");
    expect(script).toContain("/api/v1/search/find");
    expect(script).toContain("X-OpenViking-Agent: ${AGENT_ID}");
    expect(script).not.toContain("ov find");
    expect(script).not.toContain("ov add-memory");
    expect(script).not.toContain("ov add-resource");
  });

  it("uses hard mandatory language — must, not suggestion", async () => {
    const body = await provider.buildReadReminder(ws, "grp-xyz");
    expect(body).toContain("MUST");
    expect(body).toContain("hard requirement");
    expect(body).not.toContain("Query past moments before acting via");
  });

  it("memory.sh uses the find endpoint's real request shape (target_uri + limit, not node_limit)", async () => {
    await provider.buildReadReminder(ws, "grp-xyz");
    const script = readFileSync(join(ws, "memory.sh"), "utf8");
    expect(script).toContain("target_uri");
    expect(script).toContain("limit");
    expect(script).not.toContain("node_limit");
  });

  it("reminder body wraps bash invocation in a fenced code block", async () => {
    const body = await provider.buildReadReminder(ws, "grp-xyz");
    const fence = body.match(/```[\s\S]*?memory\.sh[\s\S]*?```/);
    expect(fence).not.toBeNull();
  });
});

describe("OpenVikingMemoryProvider.buildSaveReminder", () => {
  const provider = new OpenVikingMemoryProvider(51234);

  it("uses the memory.sh save command and wraps in a code fence", () => {
    const body = provider.buildSaveReminder("/ws/x");
    expect(body).toContain("bash /ws/x/memory.sh save");
    const fence = body.match(/```[\s\S]*?memory\.sh save[\s\S]*?```/);
    expect(fence).not.toBeNull();
  });

  it("includes the writing pattern", () => {
    const body = provider.buildSaveReminder("/ws/x");
    expect(body).toContain("All substance stays. Only fluff dies.");
  });

  it("buildSaveReminder uses hard mandatory language", () => {
    const body = provider.buildSaveReminder("/ws/x");
    expect(body).toContain("MUST");
    expect(body).toContain("hard requirement");
  });
});

describe("OpenVikingMemoryProvider.shutdown", () => {
  function makeFakeProc(): {
    proc: ChildProcess;
    killCalls: NodeJS.Signals[];
    simulateExit: () => void;
  } {
    const killCalls: NodeJS.Signals[] = [];
    const emitter = new EventEmitter() as EventEmitter & {
      kill?: unknown;
      pid?: number;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
    };
    emitter.kill = (sig: NodeJS.Signals): boolean => {
      killCalls.push(sig);
      return true;
    };
    emitter.pid = 99999;
    emitter.exitCode = null;
    emitter.signalCode = null;
    return {
      proc: emitter as unknown as ChildProcess,
      killCalls,
      simulateExit: () => emitter.emit("exit", 0, null),
    };
  }

  it("waits for the child's exit event before resolving", async () => {
    const { proc, killCalls, simulateExit } = makeFakeProc();
    const provider = new OpenVikingMemoryProvider(0, proc);

    let resolved = false;
    const promise = provider.shutdown().then(() => {
      resolved = true;
    });

    // Yield twice so any synchronously-attached listeners run.
    await new Promise((r) => setImmediate(r));
    expect(killCalls).toEqual(["SIGTERM"]);
    expect(resolved).toBe(false);

    simulateExit();
    await promise;
    expect(resolved).toBe(true);
  });

  it("resolves immediately when there is no child process handle", async () => {
    const provider = new OpenVikingMemoryProvider(0, null);
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });
});

describe("OpenVikingMemoryProvider.init", () => {
  it("POSTs /api/v1/fs/mkdir with the agent's viking URI and agent header", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ status: "ok", result: { uri: "viking://agent/grp-xyz/memories" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    const provider = new OpenVikingMemoryProvider(51234);
    await provider.init("grp-xyz", "/tmp");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:51234/api/v1/fs/mkdir");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>)["X-OpenViking-Agent"]).toBe("grp-xyz");
    expect(JSON.parse(init.body as string)).toEqual({ uri: "viking://agent/grp-xyz/memories" });
    fetchSpy.mockRestore();
  });

  it("treats ALREADY_EXISTS as success (matches CLI --parents idempotency)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          error: { code: "ALREADY_EXISTS", message: "viking://agent/grp-xyz/memories exists" },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new OpenVikingMemoryProvider(51234);
    await expect(provider.init("grp-xyz", "/tmp")).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("succeeds when sidecar returns status:ok with error:null (real sidecar response shape)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "ok",
          result: { uri: "viking://agent/grp-xyz/memories" },
          error: null,
          telemetry: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new OpenVikingMemoryProvider(51234);
    await expect(provider.init("grp-xyz", "/tmp")).resolves.toBeUndefined();
    fetchSpy.mockRestore();
  });

  it("throws on any non-ALREADY_EXISTS error", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          error: { code: "INTERNAL", message: "server explosion" },
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new OpenVikingMemoryProvider(51234);
    await expect(provider.init("grp-xyz", "/tmp")).rejects.toThrow(/server explosion/);
    fetchSpy.mockRestore();
  });
});

describe("OpenVikingMemoryProvider.delete", () => {
  it("resolves without throwing even if the ov binary or sidecar is unreachable", async () => {
    // No live sidecar in tests — the shell-out should fail silently rather
    // than propagate, matching the "idempotent, best-effort" contract.
    const provider = new OpenVikingMemoryProvider(1);
    await expect(provider.delete("grp-xyz", "/tmp")).resolves.toBeUndefined();
  });
});
