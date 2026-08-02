/**
 * Tests for isTaskNotFound.
 *
 * This guards a real @a2a-js/sdk v1.0 packaging bug, so the branches matter
 * individually: against a live server the `instanceof TaskNotFoundError` check
 * never fires (each dist bundle inlines its own A2AError base class), and the
 * server currently downgrades the JSON-RPC envelope to INTERNAL_ERROR instead
 * of TASK_NOT_FOUND. Only the message fallback catches the real-world case
 * today — cover all three so a future SDK fix doesn't silently regress it.
 */
import { describe, expect, it } from "vitest";
import { A2A_ERROR_CODE, TaskNotFoundError } from "@a2a-js/sdk/errors";
import { isTaskNotFound } from "@/lib/task-poller";

/** Mirrors what the JSON-RPC client transport actually throws. */
function transportError(envelopeCode: number, message: string): Error {
  const err = new Error(message);
  err.name = "JsonRpcTransportError";
  return Object.assign(err, { envelopeCode });
}

describe("isTaskNotFound", () => {
  it("matches what a live server sends today: INTERNAL_ERROR + a task-not-found message", () => {
    expect(
      isTaskNotFound(transportError(A2A_ERROR_CODE.INTERNAL_ERROR, "Task not found: task-1")),
    ).toBe(true);
  });

  it("matches the semantic TASK_NOT_FOUND envelope the SDK should send once fixed", () => {
    // Deliberately no "task not found" text, so only the envelope-code branch can match.
    expect(isTaskNotFound(transportError(A2A_ERROR_CODE.TASK_NOT_FOUND, "gone"))).toBe(true);
  });

  it("matches a TaskNotFoundError thrown in-process", () => {
    expect(isTaskNotFound(new TaskNotFoundError("gone"))).toBe(true);
  });

  it("does not match an unrelated transport failure", () => {
    expect(isTaskNotFound(transportError(A2A_ERROR_CODE.INTERNAL_ERROR, "ECONNREFUSED"))).toBe(
      false,
    );
  });

  it("does not match a connection error", () => {
    expect(isTaskNotFound(new Error("connect ECONNREFUSED 127.0.0.1:51001"))).toBe(false);
  });

  it("does not match non-Error values", () => {
    expect(isTaskNotFound(undefined)).toBe(false);
    expect(isTaskNotFound(null)).toBe(false);
    // A bare string mentioning the phrase must not be treated as the error.
    expect(isTaskNotFound("Task not found: task-1")).toBe(false);
  });
});
