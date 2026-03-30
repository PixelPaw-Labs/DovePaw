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
    vi.mocked(Math.random).mockReturnValue(0.8); // max = floor(0.8 * 5) + 1 = 5
    const counter = new StillRunningRetryCounter();
    expect(counter.shouldRelease()).toBe(false); // 1
    expect(counter.shouldRelease()).toBe(false); // 2
    expect(counter.shouldRelease()).toBe(false); // 3
    expect(counter.shouldRelease()).toBe(false); // 4
  });

  it("releases exactly at the threshold", () => {
    vi.mocked(Math.random).mockReturnValue(0.8); // max = 5
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 4; i++) counter.shouldRelease();
    expect(counter.shouldRelease()).toBe(true); // 5th call → release
  });

  it("resets count after release", () => {
    vi.mocked(Math.random).mockReturnValue(0.8); // max = 5 every time
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 5; i++) counter.shouldRelease(); // first release
    // count is reset — next 4 should not release
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true); // second release
  });

  it("re-randomises max after each release", () => {
    // First max = 1 (immediate release), second max = 5
    vi.mocked(Math.random)
      .mockReturnValueOnce(0) // floor(0 * 5) + 1 = 1 — used at construction
      .mockReturnValueOnce(0.8); // floor(0.8 * 5) + 1 = 5 — used after first release

    const counter = new StillRunningRetryCounter();
    expect(counter.shouldRelease()).toBe(true); // hits max=1 immediately

    // Now max is 5 — should not release for next 4 calls
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });

  it("releases on the first call when max is 1", () => {
    vi.mocked(Math.random).mockReturnValue(0); // max = 1
    const counter = new StillRunningRetryCounter();
    expect(counter.shouldRelease()).toBe(true);
  });

  it("releases on the 5th call when max is 5", () => {
    vi.mocked(Math.random).mockReturnValue(0.99); // max = floor(4.95) + 1 = 5
    const counter = new StillRunningRetryCounter();
    for (let i = 0; i < 4; i++) expect(counter.shouldRelease()).toBe(false);
    expect(counter.shouldRelease()).toBe(true);
  });
});
