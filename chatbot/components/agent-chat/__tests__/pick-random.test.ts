import { afterEach, describe, expect, it, vi } from "vitest";
import { pickRandom } from "../pick-random";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pickRandom", () => {
  it("returns n items when n < length", () => {
    const result = pickRandom([1, 2, 3, 4, 5], 3);
    expect(result).toHaveLength(3);
  });

  it("returns all items when n >= length", () => {
    const result = pickRandom([1, 2, 3], 5);
    expect(result).toHaveLength(3);
    expect(result.toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("only returns items from the input", () => {
    const input = ["a", "b", "c", "d", "e"];
    const result = pickRandom(input, 3);
    for (const r of result) {
      expect(input).toContain(r);
    }
  });

  it("does not return duplicates", () => {
    const result = pickRandom([1, 2, 3, 4, 5, 6, 7, 8], 5);
    expect(new Set(result).size).toBe(result.length);
  });

  it("does not mutate the input array", () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    pickRandom(input, 3);
    expect(input).toEqual(snapshot);
  });

  it("produces different orderings across calls", () => {
    const input = Array.from({ length: 20 }, (_, i) => i);
    const runs = Array.from({ length: 10 }, () => pickRandom(input, 8).join(","));
    expect(new Set(runs).size).toBeGreaterThan(1);
  });
});
