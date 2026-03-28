/**
 * In-memory registry of agents currently being processed by QueryAgentExecutor.
 * Shared within the A2A server process — read by the heartbeat server.
 */

const active = new Set<string>();

export function markProcessing(manifestKey: string): void {
  active.add(manifestKey);
}

export function markIdle(manifestKey: string): void {
  active.delete(manifestKey);
}

export function isProcessing(manifestKey: string): boolean {
  return active.has(manifestKey);
}
