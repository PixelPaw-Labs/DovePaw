// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const { mockAbortAll } = vi.hoisted(() => ({ mockAbortAll: vi.fn() }));

vi.mock("@/lib/db", () => ({
  closeStaleSessions: vi.fn(),
  setSessionStatus: vi.fn(),
}));

vi.mock("@/lib/session-runner", () => ({
  sessionRunner: { configure: vi.fn(), abortAll: mockAbortAll },
}));

import { gracefulShutdown, SHUTDOWN_GRACE_MS } from "../persistence.js";

describe("gracefulShutdown", () => {
  it("aborts all running sessions synchronously", () => {
    mockAbortAll.mockClear();
    gracefulShutdown(
      () => {},
      () => 0,
    );
    expect(mockAbortAll).toHaveBeenCalledOnce();
  });

  it("schedules a hard exit after SHUTDOWN_GRACE_MS so a hanging cancelTask cannot block shutdown", () => {
    const schedule = vi.fn();
    const exit = vi.fn();
    gracefulShutdown(exit, schedule);
    expect(schedule).toHaveBeenCalledOnce();
    const [fn, ms] = schedule.mock.calls[0];
    expect(ms).toBe(SHUTDOWN_GRACE_MS);
    expect(typeof fn).toBe("function");

    // Fire the scheduled callback — verify it forces exit
    (fn as () => void)();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
