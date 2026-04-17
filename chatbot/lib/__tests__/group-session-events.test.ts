import { afterEach, describe, expect, it } from "vitest";
import {
  publishSessionStarted,
  subscribeSessionStarted,
  type SessionStartedEvent,
} from "../group-session-events";

describe("group-session-events", () => {
  const abortControllers: AbortController[] = [];

  afterEach(() => {
    for (const c of abortControllers) c.abort();
    abortControllers.length = 0;
  });

  function subscribe(onEvent: (e: SessionStartedEvent) => void): AbortController {
    const ctrl = new AbortController();
    abortControllers.push(ctrl);
    subscribeSessionStarted(onEvent, ctrl.signal);
    return ctrl;
  }

  it("delivers published events to subscribers", () => {
    const received: SessionStartedEvent[] = [];
    subscribe((e) => received.push(e));
    publishSessionStarted({ agentId: "agent-a", sessionId: "s1" });
    expect(received).toEqual([{ agentId: "agent-a", sessionId: "s1" }]);
  });

  it("delivers to multiple subscribers", () => {
    const a: SessionStartedEvent[] = [];
    const b: SessionStartedEvent[] = [];
    subscribe((e) => a.push(e));
    subscribe((e) => b.push(e));
    publishSessionStarted({ agentId: "agent-x", sessionId: "s2" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("stops delivering after abort", () => {
    const received: SessionStartedEvent[] = [];
    const ctrl = subscribe((e) => received.push(e));
    publishSessionStarted({ agentId: "a", sessionId: "s3" });
    ctrl.abort();
    publishSessionStarted({ agentId: "a", sessionId: "s4" });
    expect(received).toHaveLength(1);
    expect(received[0].sessionId).toBe("s3");
  });
});
