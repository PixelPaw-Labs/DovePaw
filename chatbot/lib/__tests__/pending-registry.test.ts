import { describe, expect, it } from "vitest";
import { PendingRegistry } from "../pending-registry";

describe("PendingRegistry", () => {
  it("starts empty", () => {
    const r = new PendingRegistry();
    expect(r.hasPending()).toBe(false);
    expect(r.getPending()).toEqual([]);
  });

  it("hasPending returns true after register", () => {
    const r = new PendingRegistry();
    r.register({ awaitTool: "await_run_script", idKey: "runId", id: "run-1" });
    expect(r.hasPending()).toBe(true);
  });

  it("getPending returns all registered entries", () => {
    const r = new PendingRegistry();
    r.register({ awaitTool: "await_run_script", idKey: "runId", id: "run-1" });
    r.register({ awaitTool: "await_chat_to_fixer", idKey: "taskId", id: "task-2" });
    expect(r.getPending()).toEqual([
      { awaitTool: "await_run_script", idKey: "runId", id: "run-1" },
      { awaitTool: "await_chat_to_fixer", idKey: "taskId", id: "task-2" },
    ]);
  });

  it("resolve removes the entry by id", () => {
    const r = new PendingRegistry();
    r.register({ awaitTool: "await_run_script", idKey: "runId", id: "run-1" });
    r.register({ awaitTool: "await_chat_to_fixer", idKey: "taskId", id: "task-2" });
    r.resolve("run-1");
    expect(r.getPending()).toEqual([
      { awaitTool: "await_chat_to_fixer", idKey: "taskId", id: "task-2" },
    ]);
    expect(r.hasPending()).toBe(true);
  });

  it("hasPending returns false after all entries are resolved", () => {
    const r = new PendingRegistry();
    r.register({ awaitTool: "await_run_script", idKey: "runId", id: "run-1" });
    r.resolve("run-1");
    expect(r.hasPending()).toBe(false);
    expect(r.getPending()).toEqual([]);
  });

  it("resolve is a no-op for unknown ids", () => {
    const r = new PendingRegistry();
    r.register({ awaitTool: "await_run_script", idKey: "runId", id: "run-1" });
    r.resolve("unknown-id");
    expect(r.getPending()).toHaveLength(1);
  });

  it("re-registering same id overwrites the entry", () => {
    const r = new PendingRegistry();
    r.register({ awaitTool: "await_run_script", idKey: "runId", id: "run-1" });
    r.register({ awaitTool: "await_chat_to_fixer", idKey: "taskId", id: "run-1" });
    expect(r.getPending()).toHaveLength(1);
    expect(r.getPending()[0]!.awaitTool).toBe("await_chat_to_fixer");
  });
});
