import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { probeAgentCard } from "../a2a-client.js";

describe("probeAgentCard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("requests the agent-card endpoint on the given port", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await probeAgentCard(63198);

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:63198/.well-known/agent-card.json");
  });

  it("reports ok with a latency when the server answers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const result = await probeAgentCard(63198);

    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports not-ok when the server answers with a non-2xx status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    expect(await probeAgentCard(63198)).toEqual({ ok: false, latencyMs: expect.any(Number) });
  });

  it("reports not-ok with no latency when nothing is listening", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")));

    expect(await probeAgentCard(59901)).toEqual({ ok: false, latencyMs: null });
  });

  it("aborts the probe once the timeout elapses", async () => {
    // Resolve only if the caller's signal has already been aborted, proving the
    // timeout fired rather than the request being left to hang forever.
    const fetchMock = vi.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(await probeAgentCard(59901, 5)).toEqual({ ok: false, latencyMs: null });
  });
});
