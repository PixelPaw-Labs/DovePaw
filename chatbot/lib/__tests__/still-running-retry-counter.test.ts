import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { StillRunningRetryCounter } from "../still-running-retry-counter";

describe("StillRunningRetryCounter", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not release before the threshold is reached", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = floor(0 * 10) + 6 = 6
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 5; i++) expect(counter.shouldRelease()).toBe(false);
  });

  it("releases exactly at the threshold", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = 6
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 5; i++) counter.shouldRelease();
    expect(counter.shouldRelease()).toBe(true); // 6th call → release
  });

  it("resets count after release", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = 6 every time
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 6; i++) counter.shouldRelease(); // first release
    // count is reset — next 5 should not release
    for (let i = 0; i < 5; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true); // second release
  });

  it("re-randomises max after each release", () => {
    // First max = 6, second max = 15
    vi.mocked(Math.random)
      .mockReturnValueOnce(0) // floor(0 * 10) + 6 = 6 — used at construction
      .mockReturnValueOnce(0.99); // floor(0.99 * 10) + 6 = 15 — used after first release

    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 6; i++) counter.shouldRelease(); // first release at 6

    // Now max is 15 — should not release for next 14 calls
    for (let i = 0; i < 14; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });

  it("releases on the 6th call when max is 6", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = 6
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 5; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });

  it("releases on the 15th call when max is 15", () => {
    vi.mocked(Math.random).mockReturnValue(0.99); // max = floor(9.9) + 6 = 15
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 14; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });
});
