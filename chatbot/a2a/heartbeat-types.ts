/** Shared types and constants for the WebSocket heartbeat protocol. Safe to import in client components. */

export const WS_PORT = 7474;

export type LaunchdStatus = { loaded: boolean; running: boolean };
export type AgentStatus = {
  online: boolean;
  latency: number | null;
  launchd: LaunchdStatus | null;
  /** True when a Dove-triggered workspace run is actively executing. */
  processing: boolean;
};
export type StatusMessage = { type: "status"; agents: Record<string, AgentStatus> };
