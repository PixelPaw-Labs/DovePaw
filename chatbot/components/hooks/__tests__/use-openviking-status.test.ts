import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenVikingStatus } from "../use-openviking-status";

// ─── fetch mock ────────────────────────────────────────────────────────────────
//
// The hook polls GET /api/openviking/status, which reports whether the sidecar
// is running and the URL of its built-in Web Studio.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let statusBody: unknown;

beforeEach(() => {
  statusBody = { sidecarRunning: false };
  vi.stubGlobal("fetch", (input: string) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.endsWith("/api/openviking/status")) return Promise.resolve(jsonResponse(statusBody));
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useOpenVikingStatus", () => {
  it("defaults to not-running with no studio URL", () => {
    const { result } = renderHook(() => useOpenVikingStatus());
    expect(result.current).toEqual({ sidecarRunning: false, studioUrl: null });
  });

  it("reflects a running sidecar and its studio URL from the status endpoint", async () => {
    statusBody = { sidecarRunning: true, studioUrl: "http://127.0.0.1:62357/studio" };
    const { result } = renderHook(() => useOpenVikingStatus());
    await flushAsync();

    expect(result.current.sidecarRunning).toBe(true);
    expect(result.current.studioUrl).toBe("http://127.0.0.1:62357/studio");
  });

  it("keeps studioUrl null when the sidecar is not running", async () => {
    statusBody = { sidecarRunning: false };
    const { result } = renderHook(() => useOpenVikingStatus());
    await flushAsync();

    expect(result.current.sidecarRunning).toBe(false);
    expect(result.current.studioUrl).toBeNull();
  });
});
