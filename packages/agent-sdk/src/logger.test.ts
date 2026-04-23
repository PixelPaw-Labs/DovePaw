import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publishStatusToUI } from "./logger.js";

describe("publishStatusToUI", () => {
  beforeEach(() => {
    process.env.DOVEPAW_A2A_PORT = "9999";
    process.env.DOVEPAW_TASK_ID = "task-123";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    delete process.env.DOVEPAW_A2A_PORT;
    delete process.env.DOVEPAW_TASK_ID;
    vi.unstubAllGlobals();
  });

  it("posts to the A2A server progress endpoint", async () => {
    await publishStatusToUI("Done");
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:9999/internal/tasks/task-123/progress",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("includes message in request body", async () => {
    await publishStatusToUI("Step");
    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.message).toBe("Step");
  });

  it("includes artifacts in request body when provided", async () => {
    await publishStatusToUI("Step", { key: "EC-1", status: "ok" });
    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(call[1]!.body as string);
    expect(body.artifacts).toEqual({ key: "EC-1", status: "ok" });
  });

  it("does nothing when DOVEPAW_A2A_PORT is not set", async () => {
    delete process.env.DOVEPAW_A2A_PORT;
    await publishStatusToUI("Hello");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does nothing when DOVEPAW_TASK_ID is not set", async () => {
    delete process.env.DOVEPAW_TASK_ID;
    await publishStatusToUI("Hello");
    expect(fetch).not.toHaveBeenCalled();
  });
});
