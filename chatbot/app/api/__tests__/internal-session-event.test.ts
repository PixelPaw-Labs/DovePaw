import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/session-events", () => ({ publishSessionEvent: vi.fn() }));

import { publishSessionEvent } from "@/lib/session-events";
import { POST } from "../internal/session-event/route";

describe("POST /api/internal/session-event", () => {
  it("calls publishSessionEvent with sessionId and event", async () => {
    const req = new Request("http://localhost/api/internal/session-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "ctx-1", event: { type: "done" } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(publishSessionEvent).toHaveBeenCalledWith("ctx-1", { type: "done" });
  });

  it("returns 400 on invalid body", async () => {
    const req = new Request("http://localhost/api/internal/session-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missing: "sessionId" }),
    });
    await expect(POST(req)).rejects.toThrow();
  });
});
