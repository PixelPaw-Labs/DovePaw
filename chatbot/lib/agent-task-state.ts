import type { TaskCompletedContent } from "@/lib/task-poller";

/** "start" + "running" plus all terminal A2A task statuses — single source of truth. */
export type AgentTaskStatus = "start" | "running" | TaskCompletedContent["status"];

export type AgentStatusEvent = {
  type: "agent_status";
  agentKey: string;
  id: string;
  status: AgentTaskStatus;
};

/** Valid forward-only transitions. Terminal states have no outgoing edges. */
const VALID: Record<AgentTaskStatus, AgentTaskStatus[]> = {
  start: ["running", "failed", "canceled", "rejected"],
  running: ["completed", "failed", "canceled", "rejected"],
  completed: [],
  failed: [],
  canceled: [],
  rejected: [],
};

/**
 * In-memory state machine for in-flight agent tasks within a single Dove turn.
 * Emits a ChatSseAgentStatus event on every valid state transition.
 * Idempotent: same state twice emits no event.
 * Forward-only: terminal states (done/failed/cancelled) cannot transition back.
 */
export class AgentTaskStateMachine {
  private readonly states = new Map<string, AgentTaskStatus>();

  constructor(private readonly onTransition: (event: AgentStatusEvent) => void) {}

  transition(id: string, agentKey: string, status: AgentTaskStatus): void {
    const current = this.states.get(id);
    if (current === status) return;
    if (current && !VALID[current].includes(status)) return;
    this.states.set(id, status);
    this.onTransition({ type: "agent_status", agentKey, id, status });
  }
}
