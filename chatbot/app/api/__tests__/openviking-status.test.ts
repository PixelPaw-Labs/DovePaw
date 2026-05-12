import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, existsSync, rmSync } from "node:fs";

const { PORT_FILE_FOR_TEST } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dovepaw-ov-status-"));
  return { TMP_ROOT_FOR_TEST: root, PORT_FILE_FOR_TEST: path.join(root, ".port.json") };
});

vi.mock("@@/lib/paths", async () => {
  const actual = await vi.importActual<typeof import("@@/lib/paths")>("@@/lib/paths");
  return { ...actual, OPENVIKING_PORT_FILE: PORT_FILE_FOR_TEST };
});

vi.mock("@/lib/openviking/console", () => ({
  getConsoleUrl: vi.fn(),
  launchConsole: vi.fn(),
}));

import { GET } from "../openviking/status/route";
import { POST } from "../openviking/console/route";
import { getConsoleUrl, launchConsole } from "@/lib/openviking/console";

describe("GET /api/openviking/status", () => {
  beforeEach(() => {
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
    vi.mocked(getConsoleUrl).mockReturnValue(null);
  });
  afterEach(() => {
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });

  it("returns sidecarRunning=false and no consoleUrl when port file is absent", async () => {
    const res = await GET();
    const body = (await res.json()) as { sidecarRunning: boolean; consoleUrl?: string };
    expect(body.sidecarRunning).toBe(false);
    expect(body.consoleUrl).toBeUndefined();
  });

  it("returns sidecarRunning=true when port file exists", async () => {
    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 1234 }));
    const res = await GET();
    const body = (await res.json()) as { sidecarRunning: boolean };
    expect(body.sidecarRunning).toBe(true);
  });

  it("returns consoleUrl when the console has been launched", async () => {
    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 1234 }));
    vi.mocked(getConsoleUrl).mockReturnValue("http://127.0.0.1:8020");
    const res = await GET();
    const body = (await res.json()) as { consoleUrl?: string };
    expect(body.consoleUrl).toBe("http://127.0.0.1:8020");
  });
});

describe("POST /api/openviking/console", () => {
  beforeEach(() => {
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
    vi.mocked(launchConsole).mockReset();
  });
  afterEach(() => {
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });

  it("returns 409 when sidecar is not running", async () => {
    const res = await POST();
    expect(res.status).toBe(409);
  });

  it("invokes launchConsole with the sidecar port and returns the URL", async () => {
    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 5678 }));
    vi.mocked(launchConsole).mockResolvedValue("http://127.0.0.1:8020");
    const res = await POST();
    expect(launchConsole).toHaveBeenCalledWith(5678);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe("http://127.0.0.1:8020");
  });
});
