import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, existsSync, rmSync } from "node:fs";

const { PORT_FILE_FOR_TEST } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require("node:os") as typeof import("node:os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dovepaw-ov-version-"));
  return { PORT_FILE_FOR_TEST: path.join(root, ".port.json") };
});

vi.mock("@@/lib/paths", async () => {
  const actual = await vi.importActual<typeof import("@@/lib/paths")>("@@/lib/paths");
  return { ...actual, OPENVIKING_PORT_FILE: PORT_FILE_FOR_TEST };
});

import { GET } from "../openviking/version/route";

const PYPI_URL = "https://pypi.org/pypi/openviking/json";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let healthResponder: () => Response;
let pypiResponder: () => Response;

beforeEach(() => {
  if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  healthResponder = () => jsonResponse({ status: "ok", healthy: true, version: "0.3.16" });
  pypiResponder = () => jsonResponse({ info: { version: "0.3.23" } });
  vi.stubGlobal("fetch", (input: string) => {
    const url = typeof input === "string" ? input : String(input);
    if (url === PYPI_URL) return Promise.resolve(pypiResponder());
    if (url.includes("/health")) return Promise.resolve(healthResponder());
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
});

afterEach(() => {
  if (existsSync(PORT_FILE_FOR_TEST)) rmSync(PORT_FILE_FOR_TEST);
  vi.restoreAllMocks();
});

describe("GET /api/openviking/version", () => {
  it("returns current (from sidecar /health) and latest (from PyPI)", async () => {
    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 1234 }));
    const res = await GET();
    expect(await res.json()).toEqual({ current: "0.3.16", latest: "0.3.23" });
  });

  it("returns current=null when the sidecar is down; latest still resolves", async () => {
    const res = await GET(); // no port file written
    const body = (await res.json()) as { current: string | null; latest: string | null };
    expect(body.current).toBeNull();
    expect(body.latest).toBe("0.3.23");
  });

  it("returns latest=null when PyPI is unreachable; current still resolves", async () => {
    writeFileSync(PORT_FILE_FOR_TEST, JSON.stringify({ port: 1234 }));
    pypiResponder = () => {
      throw new Error("network down");
    };
    const res = await GET();
    const body = (await res.json()) as { current: string | null; latest: string | null };
    expect(body.current).toBe("0.3.16");
    expect(body.latest).toBeNull();
  });
});
