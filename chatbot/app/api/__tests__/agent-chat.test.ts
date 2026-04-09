/**
 * Tests for POST /api/agent/[name]/chat
 * Verifies: 404 for unknown agents, 503 when servers not running,
 * and SSE streaming of A2A artifact events.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Hoisted mocks (must be before vi.mock calls) ────────────────────────────
// vi.hoisted creates variables that are accessible inside vi.mock factory closures.

const mockSendMessageStream = vi.hoisted(() => vi.fn());
const mockCancelTask = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockCreateFromUrl = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    sendMessageStream: mockSendMessageStream,
    cancelTask: mockCancelTask,
  }),
);

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@@/lib/agents", () => ({
  AGENTS: [
    { name: "test-agent", manifestKey: "test_agent", displayName: "Test Agent" },
    { name: "other-agent", manifestKey: "other_agent", displayName: "Other Agent" },
  ],
}));

vi.mock("@@/lib/agents-config", () => ({
  readAgentsConfig: vi.fn(() => [
    { name: "test-agent", manifestKey: "test_agent", displayName: "Test Agent" },
    { name: "other-agent", manifestKey: "other_agent", displayName: "Other Agent" },
  ]),
}));

vi.mock("@/a2a/lib/ports-manifest", () => ({
  readPortsManifest: vi.fn(),
}));

// ClientFactory must use a regular function (not arrow) so it works as a constructor mock
vi.mock("@a2a-js/sdk/client", () => ({
  ClientFactory: vi.fn(function (this: unknown) {
    return { createFromUrl: mockCreateFromUrl };
  }),
}));

import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import { POST } from "../agent/[name]/chat/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(name: string, body: object = { message: "hello", sessionId: null }) {
  return {
    request: new Request(`http://localhost/api/agent/${name}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ name }),
  };
}

async function drainStream(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new TextDecoder().decode(value));
  }
  return chunks.join("");
}

function parseSseEvents(body: string): object[] {
  return body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice(6)));
}

// ─── Stream factory ───────────────────────────────────────────────────────────

function makeStream(artifacts: Array<{ name: string; text: string }> = []) {
  const events = [
    { kind: "task", id: "task-123" },
    ...artifacts.map((a) => ({
      kind: "artifact-update",
      artifact: {
        artifactId: "art-1",
        name: a.name,
        parts: [{ kind: "text", text: a.text }],
      },
    })),
    {
      kind: "status-update",
      status: { state: "completed" },
      taskId: "task-123",
      final: true,
      contextId: "",
    },
  ];
  async function* gen() {
    for (const e of events) yield e;
  }
  return gen();
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessageStream.mockReturnValue(makeStream());
  mockCreateFromUrl.mockResolvedValue({
    sendMessageStream: mockSendMessageStream,
    cancelTask: mockCancelTask,
  });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/agent/[name]/chat — validation", () => {
  it("returns 404 for an unknown agent name", async () => {
    const { request, params } = makeRequest("nonexistent-agent");
    const response = await POST(request, { params });
    expect(response.status).toBe(404);
  });

  it("returns 503 when port manifest is missing", async () => {
    vi.mocked(readPortsManifest).mockReturnValue(null);
    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    expect(response.status).toBe(503);
  });

  it("returns 503 when agent port is absent from manifest", async () => {
    vi.mocked(readPortsManifest).mockReturnValue({
      updatedAt: "2025-01-01",
      other_agent: 4001,
    } as unknown as ReturnType<typeof readPortsManifest>);
    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    expect(response.status).toBe(503);
  });
});

describe("POST /api/agent/[name]/chat — SSE streaming", () => {
  beforeEach(() => {
    vi.mocked(readPortsManifest).mockReturnValue({
      updatedAt: "2025-01-01",
      test_agent: 5001,
    } as unknown as ReturnType<typeof readPortsManifest>);
  });

  it("returns text/event-stream response", async () => {
    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("emits session event with task ID", async () => {
    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    const body = await drainStream(response);
    const events = parseSseEvents(body);

    const sessionEvent = events.find((e) => (e as { type: string }).type === "session");
    expect(sessionEvent).toMatchObject({ type: "session", sessionId: "task-123" });
  });

  it("maps stream artifact to text SSE event", async () => {
    mockSendMessageStream.mockReturnValue(makeStream([{ name: "stream", text: "hello world" }]));

    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    const body = await drainStream(response);
    const events = parseSseEvents(body);

    const textEvent = events.find((e) => (e as { type: string }).type === "text");
    expect(textEvent).toMatchObject({ type: "text", content: "hello world" });
  });

  it("maps thinking artifact to thinking SSE event", async () => {
    mockSendMessageStream.mockReturnValue(makeStream([{ name: "thinking", text: "let me think" }]));

    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    const body = await drainStream(response);
    const events = parseSseEvents(body);

    const thinkingEvent = events.find((e) => (e as { type: string }).type === "thinking");
    expect(thinkingEvent).toMatchObject({ type: "thinking", content: "let me think" });
  });

  it("maps tool-call artifact to tool_call SSE event", async () => {
    mockSendMessageStream.mockReturnValue(makeStream([{ name: "tool-call", text: "Read" }]));

    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    const body = await drainStream(response);
    const events = parseSseEvents(body);

    const toolCallEvent = events.find((e) => (e as { type: string }).type === "tool_call");
    expect(toolCallEvent).toMatchObject({ type: "tool_call", name: "Read" });
  });

  it("maps tool-input artifact to tool_input SSE event", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([{ name: "tool-input", text: '{"file":"/foo"}' }]),
    );

    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    const body = await drainStream(response);
    const events = parseSseEvents(body);

    const toolInputEvent = events.find((e) => (e as { type: string }).type === "tool_input");
    expect(toolInputEvent).toMatchObject({ type: "tool_input", content: '{"file":"/foo"}' });
  });

  it("maps final-output artifact to result SSE event", async () => {
    mockSendMessageStream.mockReturnValue(
      makeStream([{ name: "final-output", text: "task done" }]),
    );

    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    const body = await drainStream(response);
    const events = parseSseEvents(body);

    const resultEvent = events.find((e) => (e as { type: string }).type === "result");
    expect(resultEvent).toMatchObject({ type: "result", content: "task done" });
  });

  it("emits done event at end of stream", async () => {
    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    const body = await drainStream(response);
    const events = parseSseEvents(body);

    const doneEvent = events.find((e) => (e as { type: string }).type === "done");
    expect(doneEvent).toMatchObject({ type: "done" });
  });

  it("sends message to A2A server on the correct port", async () => {
    const { request, params } = makeRequest("test-agent");
    const response = await POST(request, { params });
    // Must drain the stream to trigger the async start() callback where ClientFactory is used
    await drainStream(response);

    expect(mockCreateFromUrl).toHaveBeenCalledWith("http://localhost:5001");
  });
});
