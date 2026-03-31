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
    vi.mocked(Math.random).mockReturnValue(0); // max = floor(0 * 3) + 3 = 3
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 2; i++) expect(counter.shouldRelease()).toBe(false);
  });

  it("releases exactly at the threshold", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = 3
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 2; i++) counter.shouldRelease();
    expect(counter.shouldRelease()).toBe(true); // 3rd call → release
  });

  it("resets count after release", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = 3 every time
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 3; i++) counter.shouldRelease(); // first release
    // count is reset — next 2 should not release
    for (let i = 0; i < 2; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true); // second release
  });

  it("re-randomises max after each release", () => {
    // First max = 3, second max = 5
    vi.mocked(Math.random)
      .mockReturnValueOnce(0) // floor(0 * 3) + 3 = 3 — used at construction
      .mockReturnValueOnce(0.99); // floor(0.99 * 3) + 3 = 5 — used after first release

    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 3; i++) counter.shouldRelease(); // first release at 3

    // Now max is 5 — should not release for next 4 calls
    for (let i = 0; i < 4; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });

  it("releases on the 3rd call when max is 3", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = 3
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 2; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });

  it("releases on the 5th call when max is 5", () => {
    vi.mocked(Math.random).mockReturnValue(0.99); // max = floor(2.97) + 3 = 5
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 4; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });
});
