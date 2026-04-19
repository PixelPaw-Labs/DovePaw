/**
 * In-process group stream pool — multiplexes member agent events into a single
 * SSE stream per group task, keyed by groupContextId.
 *
 * Used by:
 *   - query-agent-executor.ts (executeInGroupMode) — publishes member events
 *   - /api/groups/stream/[groupContextId]/route.ts — subscribes and forwards to frontend
 */

import { EventEmitter } from "node:events";

export interface GroupStreamEvent {
  agentId: string;
  text: string;
  /** "progress" | "done" | "error" */
  type: "progress" | "done" | "error";
}

type Listener = (event: GroupStreamEvent) => void;

class GroupStreamPool {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  publish(groupContextId: string, event: GroupStreamEvent): void {
    this.emitter.emit(groupContextId, event);
  }

  subscribe(groupContextId: string, listener: Listener, signal: AbortSignal): void {
    this.emitter.on(groupContextId, listener);
    signal.addEventListener("abort", () => this.emitter.off(groupContextId, listener), {
      once: true,
    });
  }
}

export const groupStreamPool = new GroupStreamPool();
