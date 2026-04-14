import { describe, expect, it } from "vitest";
import {
  addPendingQuestion,
  hasPendingQuestion,
  resolvePendingQuestion,
  abortPendingQuestions,
} from "../pending-questions";

// Use unique IDs per test to avoid state pollution across the shared globalThis Map.

describe("addPendingQuestion / hasPendingQuestion", () => {
  it("returns a pending promise and marks the id as pending", () => {
    const id = "pq-has-1";
    const promise = addPendingQuestion(id);
    expect(hasPendingQuestion(id)).toBe(true);
    // Clean up to avoid leaking into other tests
    resolvePendingQuestion(id, {});
    void promise;
  });

  it("returns false for an unknown id", () => {
    expect(hasPendingQuestion("pq-unknown-xyz")).toBe(false);
  });
});

describe("resolvePendingQuestion", () => {
  it("resolves the promise with the provided answers", async () => {
    const id = "pq-resolve-1";
    const promise = addPendingQuestion(id);
    const answers = { "What now?": "Later", "Which one?": "A" };
    const ok = resolvePendingQuestion(id, answers);
    expect(ok).toBe(true);
    await expect(promise).resolves.toEqual(answers);
  });

  it("removes the id from pending after resolving", () => {
    const id = "pq-resolve-2";
    void addPendingQuestion(id);
    resolvePendingQuestion(id, {});
    expect(hasPendingQuestion(id)).toBe(false);
  });

  it("returns false for an unknown id", () => {
    expect(resolvePendingQuestion("pq-noop-xyz", {})).toBe(false);
  });

  it("is idempotent — second call on same id returns false", () => {
    const id = "pq-idempotent-1";
    void addPendingQuestion(id);
    expect(resolvePendingQuestion(id, {})).toBe(true);
    expect(resolvePendingQuestion(id, {})).toBe(false);
  });
});

describe("abortPendingQuestions", () => {
  it("resolves each id with empty answers", async () => {
    const id1 = "pq-abort-1";
    const id2 = "pq-abort-2";
    const p1 = addPendingQuestion(id1);
    const p2 = addPendingQuestion(id2);
    abortPendingQuestions(new Set([id1, id2]));
    await expect(p1).resolves.toEqual({});
    await expect(p2).resolves.toEqual({});
  });

  it("removes aborted ids from pending", () => {
    const id = "pq-abort-3";
    void addPendingQuestion(id);
    abortPendingQuestions(new Set([id]));
    expect(hasPendingQuestion(id)).toBe(false);
  });

  it("ignores ids that are not pending", () => {
    // Should not throw
    expect(() => abortPendingQuestions(new Set(["pq-abort-missing"]))).not.toThrow();
  });
});
