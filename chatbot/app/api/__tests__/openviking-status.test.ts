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

import { GET } from "../openviking/status/route";

describe("GET /api/openviking/status", () => {
  beforeEach(() => {
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });
  afterEach(() => {
    if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  });

  it("returns sidecarRunning=false and no studioUrl when the port file is absent", async () => {
    const res = await GET();
    const body = (await res.json()) as { sidecarRunning: boolean; studioUrl?: string };
    expect(body.sidecarRunning).toBe(false);
    expect(body.studioUrl).toBeUndefined();
  });

  it("returns sidecarRunning=true and the /studio URL when the port file exists", async () => {
    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 1234 }));
    const res = await GET();
    const body = (await res.json()) as { sidecarRunning: boolean; studioUrl?: string };
    expect(body.sidecarRunning).toBe(true);
    expect(body.studioUrl).toBe("http://127.0.0.1:1234/studio");
  });

  it("returns sidecarRunning=false when the port file is malformed", async () => {
    writeFileSync(PORT_FILE_FOR_TEST, "not json");
    const res = await GET();
    const body = (await res.json()) as { sidecarRunning: boolean };
    expect(body.sidecarRunning).toBe(false);
  });
});
