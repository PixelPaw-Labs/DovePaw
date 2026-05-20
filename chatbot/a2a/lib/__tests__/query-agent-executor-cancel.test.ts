// @vitest-environment node
/**
 * Unit tests for QueryAgentExecutor.cancelTask().
 *
 * Invariant: STOP must abort the in-flight query but MUST NOT delete the
 * sub-agent workspace. Workspace deletion belongs to the explicit DELETE
 * path (POST /session/clear), not to cancelTask.
 *
 * See docs/specs/11-abort-pipeline.md Concern 1 for the original bug trace.
 */
import { describe, it, expect, vi } from "vitest";
import { QueryAgentExecutor } from "../query-agent-executor.js";
import type { SessionManager } from "@/lib/session-manager";
import type { AgentDef } from "@@/lib/agents";

function makeMockSessionManager(): SessionManager & {
  delete: ReturnType<typeof vi.fn>;
} {
  return {
    delete: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    getSessions: vi.fn().mockReturnValue([]),
  } as unknown as SessionManager & { delete: ReturnType<typeof vi.fn> };
}

const STUB_DEF: AgentDef = {
  name: "test-agent",
  alias: "test",
  displayName: "Test Agent",
  manifestKey: "test_agent",
  description: "stub",
  scriptPath: "/tmp/test/main.ts",
  whatItDoes: "stub",
} as unknown as AgentDef;

describe("QueryAgentExecutor.cancelTask()", () => {
  it("aborts the in-flight controller but does NOT delete the workspace", async () => {
    const sm = makeMockSessionManager();
    const exec = new QueryAgentExecutor(STUB_DEF, sm);

    // Simulate an in-flight execute() — populate the abort controller.
    const ac = new AbortController();
    const abortSpy = vi.spyOn(ac, "abort");
    (exec as unknown as { abortController: AbortController | null }).abortController = ac;

    await exec.cancelTask();

    expect(abortSpy).toHaveBeenCalledOnce();
    expect(sm.delete).not.toHaveBeenCalled();
  });

  it("is safe to call when there is no in-flight controller or context", async () => {
    const sm = makeMockSessionManager();
    const exec = new QueryAgentExecutor(STUB_DEF, sm);

    await expect(exec.cancelTask()).resolves.toBeUndefined();
    expect(sm.delete).not.toHaveBeenCalled();
  });
});
