import { describe, it, expect } from "vitest";
import { createSseResponse } from "../sse-response";

async function collectSse(response: Response): Promise<string[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => chunk.slice("data: ".length));
}

function makeRequest(abortSignal?: AbortSignal): Request {
  return { signal: abortSignal ?? new AbortController().signal } as Request;
}

describe("createSseResponse", () => {
  it("returns a text/event-stream response", () => {
    const res = createSseResponse(makeRequest(), new AbortController(), async (send) => {
      send({ type: "done" });
    });
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("encodes events as SSE data lines", async () => {
    const res = createSseResponse(makeRequest(), new AbortController(), async (send) => {
      send({ type: "text", content: "hello" });
      send({ type: "done" });
    });
    const lines = await collectSse(res);
    expect(lines).toContain(JSON.stringify({ type: "text", content: "hello" }));
    expect(lines).toContain(JSON.stringify({ type: "done" }));
  });

  it("aborts the connectionController when the request signal aborts", () => {
    const ac = new AbortController();
    const request = makeRequest(ac.signal);
    let capturedConnectionController: AbortController | undefined;
    createSseResponse(request, new AbortController(), async (_send, connectionController) => {
      capturedConnectionController = connectionController;
      await new Promise(() => {}); // never resolves
    });
    expect(capturedConnectionController!.signal.aborted).toBe(false);
    ac.abort();
    expect(capturedConnectionController!.signal.aborted).toBe(true);
  });

  it("does not abort the subprocessController when the request signal aborts", () => {
    const ac = new AbortController();
    const request = makeRequest(ac.signal);
    const subprocessController = new AbortController();
    createSseResponse(request, subprocessController, async () => {
      await new Promise(() => {}); // never resolves
    });
    expect(subprocessController.signal.aborted).toBe(false);
    ac.abort();
    expect(subprocessController.signal.aborted).toBe(false);
  });

  it("closes the stream after the handler resolves", async () => {
    const res = createSseResponse(makeRequest(), new AbortController(), async (send) => {
      send({ type: "done" });
    });
    // Reading the full body without hanging confirms the stream was closed
    await res.text();
    expect(true).toBe(true);
  });
});
