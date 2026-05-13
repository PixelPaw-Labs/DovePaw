import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up isolated config paths before importing the route.
const { TMP_ROOT_FOR_TEST, PORT_FILE_FOR_TEST } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dovepaw-ovconfig-"));
  return {
    TMP_ROOT_FOR_TEST: root,
    PORT_FILE_FOR_TEST: path.join(root, ".port.json"),
  };
});
vi.mock("@@/lib/paths", async () => {
  const actual = await vi.importActual<typeof import("@@/lib/paths")>("@@/lib/paths");
  return {
    ...actual,
    OPENVIKING_CONFIG_DIR: TMP_ROOT_FOR_TEST,
    OPENVIKING_SERVER_CONFIG: join(TMP_ROOT_FOR_TEST, "ov.conf"),
    OPENVIKING_CLI_CONFIG: join(TMP_ROOT_FOR_TEST, "ovcli.conf"),
    OPENVIKING_PORT_FILE: PORT_FILE_FOR_TEST,
  };
});

// Stub the user-global fallback path so prefill testing is hermetic.
vi.mock("@/lib/openviking/prefill", () => ({
  USER_GLOBAL_OV_CONF: join(mkdtempSync(join(tmpdir(), "dovepaw-userglobal-")), "ov.conf"),
}));

// Don't actually boot a sidecar in POST handler tests.
vi.mock("@/lib/memory", async () => {
  const actual = await vi.importActual<typeof import("@/lib/memory")>("@/lib/memory");
  return {
    ...actual,
    setMemoryProvider: vi.fn(),
  };
});
vi.mock("@/lib/memory/openviking", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/memory/openviking")>("@/lib/memory/openviking");
  return {
    ...actual,
    OpenVikingMemoryProvider: Object.assign(actual.OpenVikingMemoryProvider, {
      boot: vi.fn().mockResolvedValue({ port: 12345, shutdown: vi.fn() }),
    }),
  };
});

import { OPENVIKING_SERVER_CONFIG } from "@@/lib/paths";
import { USER_GLOBAL_OV_CONF } from "@/lib/openviking/prefill";
import { OpenVikingMemoryProvider } from "@/lib/memory/openviking";
import { GET, POST } from "../openviking/config/route";

const SAMPLE_CONFIG = {
  server: {
    host: "0.0.0.0",
    port: 1933,
    auth_mode: "api_key",
    root_api_key: "rootkey",
  },
  embedding: {
    dense: {
      provider: "openai",
      model: "text-embedding-3-small",
      api_key: "sk-fake",
      api_base: "https://api.openai.com/v1",
      dimension: 1536,
    },
  },
  storage: { workspace: "/tmp/ov-data" },
};

describe("GET /api/openviking/config", () => {
  beforeEach(() => {
    if (existsSync(OPENVIKING_SERVER_CONFIG)) rmSync(OPENVIKING_SERVER_CONFIG);
    if (existsSync(USER_GLOBAL_OV_CONF)) rmSync(USER_GLOBAL_OV_CONF);
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });
  afterEach(() => {
    if (existsSync(OPENVIKING_SERVER_CONFIG)) rmSync(OPENVIKING_SERVER_CONFIG);
    if (existsSync(USER_GLOBAL_OV_CONF)) rmSync(USER_GLOBAL_OV_CONF);
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });

  it("sidecarRunning is true only when the port file exists", async () => {
    writeFileSync(OPENVIKING_SERVER_CONFIG, JSON.stringify(SAMPLE_CONFIG));
    let res = await GET();
    let body = (await res.json()) as { sidecarRunning: boolean };
    expect(body.sidecarRunning).toBe(false);

    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 12345 }));
    res = await GET();
    body = (await res.json()) as { sidecarRunning: boolean };
    expect(body.sidecarRunning).toBe(true);
  });

  it("returns the dovepaw-scoped config when it exists", async () => {
    writeFileSync(OPENVIKING_SERVER_CONFIG, JSON.stringify(SAMPLE_CONFIG));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: typeof SAMPLE_CONFIG; source: string };
    expect(body.source).toBe("dovepaw");
    expect(body.config.embedding.dense.api_key).toBe("sk-fake");
  });

  it("falls back to the user-global ~/.openviking/ov.conf when dovepaw config is missing", async () => {
    writeFileSync(USER_GLOBAL_OV_CONF, JSON.stringify(SAMPLE_CONFIG));
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { config: typeof SAMPLE_CONFIG; source: string };
    expect(body.source).toBe("user-global-prefill");
    expect(body.config.embedding.dense.provider).toBe("openai");
  });

  it("returns 200 with source=empty when neither file exists", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe("empty");
  });
});

describe("POST /api/openviking/config", () => {
  beforeEach(() => {
    if (existsSync(OPENVIKING_SERVER_CONFIG)) rmSync(OPENVIKING_SERVER_CONFIG);
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });
  afterEach(() => {
    if (existsSync(OPENVIKING_SERVER_CONFIG)) rmSync(OPENVIKING_SERVER_CONFIG);
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });

  it("validates the body and writes the dovepaw-scoped ov.conf", async () => {
    const request = new Request("http://localhost/api/openviking/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: SAMPLE_CONFIG }),
    });
    const res = await POST(request);
    expect(res.status).toBe(200);
    expect(existsSync(OPENVIKING_SERVER_CONFIG)).toBe(true);
    const written = JSON.parse(readFileSync(OPENVIKING_SERVER_CONFIG, "utf-8"));
    expect(written.embedding.dense.provider).toBe("openai");
  });

  it("rejects bodies missing embedding.dense.provider", async () => {
    const bad = { config: { server: SAMPLE_CONFIG.server, embedding: { dense: {} } } };
    const request = new Request("http://localhost/api/openviking/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bad),
    });
    const res = await POST(request);
    expect(res.status).toBe(400);
  });

  it("calls shutdown via duck-type check, surviving HMR-divergent class identity", async () => {
    // Simulate the Next.js dev HMR case: the override returned by
    // getMemoryProvider is an OpenViking-shaped object whose class identity
    // does NOT match the OpenVikingMemoryProvider imported by route.ts. The
    // POST handler must still call .shutdown() on it.
    const shutdownSpy = vi.fn().mockResolvedValue(undefined);
    const fakeOverride = {
      port: 11111,
      proc: null,
      initGroup: vi.fn().mockResolvedValue(undefined),
      deleteGroup: vi.fn().mockResolvedValue(undefined),
      buildReminder: () => "",
      shutdown: shutdownSpy,
    };
    const memoryModule = await import("@/lib/memory");
    vi.spyOn(memoryModule, "getMemoryProvider").mockResolvedValueOnce(
      fakeOverride as unknown as Awaited<ReturnType<typeof memoryModule.getMemoryProvider>>,
    );

    const request = new Request("http://localhost/api/openviking/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: SAMPLE_CONFIG }),
    });
    await POST(request);
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it("removes the stale port file when boot fails so consumers don't see a dead sidecar", async () => {
    // Simulate a previously-running sidecar — its port file is still on disk.
    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 57658 }));
    vi.mocked(OpenVikingMemoryProvider.boot).mockRejectedValueOnce(
      new Error("Health probe at http://localhost:49793/health did not respond within 30000ms"),
    );

    const request = new Request("http://localhost/api/openviking/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: SAMPLE_CONFIG }),
    });
    const res = await POST(request);
    const body = (await res.json()) as { status: string };

    expect(res.status).toBe(200);
    expect(body.status).toBe("config-saved-sidecar-down");
    expect(existsSync(PORT_FILE_FOR_TEST)).toBe(false);
  });

  it("writes dev-mode server block and drops any root_api_key the body sends", async () => {
    // Stale on-disk config simulates a previously api_key-mode setup.
    writeFileSync(OPENVIKING_SERVER_CONFIG, JSON.stringify(SAMPLE_CONFIG));
    const request = new Request("http://localhost/api/openviking/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: SAMPLE_CONFIG }),
    });
    const res = await POST(request);
    expect(res.status).toBe(200);
    const written = JSON.parse(readFileSync(OPENVIKING_SERVER_CONFIG, "utf-8"));
    expect(written.server.auth_mode).toBe("dev");
    expect(written.server.host).toBe("127.0.0.1");
    expect(written.server.root_api_key).toBeUndefined();
  });
});
