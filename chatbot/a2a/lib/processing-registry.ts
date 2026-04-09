/**
 * In-memory registry of agents currently being processed by QueryAgentExecutor.
 * Shared within the A2A server process — read by the heartbeat server.
 *
 * Also stores each agent's AbortController so cancelTask() can abort
 * the running query and kill its Claude Code subprocess via the signal.
 */

export type ProcessingTrigger = "scheduled" | "dove";

const active = new Map<string, ProcessingTrigger>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

/** Subscribe to any processing state change. Returns an unsubscribe function. */
export function onProcessingChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markProcessing(
  manifestKey: string,
  controller: AbortController,
  trigger: ProcessingTrigger,
): void {
  active.set(manifestKey, trigger);
  controllers.set(manifestKey, controller);
  notifyListeners();
}

export function markIdle(manifestKey: string): void {
  active.delete(manifestKey);
  controllers.delete(manifestKey);
  notifyListeners();
}

export function isProcessing(manifestKey: string): boolean {
  return active.has(manifestKey);
}

export function getProcessingTrigger(manifestKey: string): ProcessingTrigger | null {
  return active.get(manifestKey) ?? null;
}

/**
 * Abort the running query for this agent (kills tsx subprocess + claude CLI).
 * No-op if the agent is not currently processing.
 */
export function cancelProcessing(manifestKey: string): void {
  controllers.get(manifestKey)?.abort();
}
