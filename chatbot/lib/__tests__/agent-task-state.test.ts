import { describe, expect, it, vi } from "vitest";
import { AgentTaskStateMachine } from "@/lib/agent-task-state";
import type { AgentStatusEvent } from "@/lib/agent-task-state";

describe("AgentTaskStateMachine", () => {
  function setup() {
    const onTransition = vi.fn((event: AgentStatusEvent) => {
      void event;
    });
    const sm = new AgentTaskStateMachine(onTransition);
    return { sm, onTransition };
  }

  it("emits running on first transition from unknown state", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    expect(onTransition).toHaveBeenCalledOnce();
    expect(onTransition).toHaveBeenCalledWith({
      type: "agent_status",
      agentKey: "my_agent",
      id: "t1",
      status: "running",
    });
  });

  it("running → running is idempotent (no duplicate event)", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    sm.transition("t1", "my_agent", "running");
    expect(onTransition).toHaveBeenCalledOnce();
  });

  it("running → completed emits completed event", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    sm.transition("t1", "my_agent", "completed");
    expect(onTransition).toHaveBeenCalledTimes(2);
    expect(onTransition).toHaveBeenLastCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("running → failed emits failed event", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    sm.transition("t1", "my_agent", "failed");
    expect(onTransition).toHaveBeenCalledTimes(2);
    expect(onTransition).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("running → canceled emits canceled event", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    sm.transition("t1", "my_agent", "canceled");
    expect(onTransition).toHaveBeenCalledTimes(2);
    expect(onTransition).toHaveBeenLastCalledWith(expect.objectContaining({ status: "canceled" }));
  });

  it("running → rejected emits rejected event", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    sm.transition("t1", "my_agent", "rejected");
    expect(onTransition).toHaveBeenCalledTimes(2);
    expect(onTransition).toHaveBeenLastCalledWith(expect.objectContaining({ status: "rejected" }));
  });

  it("completed → running is silently ignored", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    sm.transition("t1", "my_agent", "completed");
    sm.transition("t1", "my_agent", "running");
    expect(onTransition).toHaveBeenCalledTimes(2);
  });

  it("failed → completed is silently ignored", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "my_agent", "running");
    sm.transition("t1", "my_agent", "failed");
    sm.transition("t1", "my_agent", "completed");
    expect(onTransition).toHaveBeenCalledTimes(2);
  });

  it("tracks multiple task IDs independently", () => {
    const { sm, onTransition } = setup();
    sm.transition("t1", "agent_a", "running");
    sm.transition("t2", "agent_b", "running");
    sm.transition("t1", "agent_a", "completed");
    sm.transition("t2", "agent_b", "failed");
    expect(onTransition).toHaveBeenCalledTimes(4);
    expect(onTransition).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ id: "t1", status: "completed" }),
    );
    expect(onTransition).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ id: "t2", status: "failed" }),
    );
  });
});
