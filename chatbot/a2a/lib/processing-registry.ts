/**
 * In-memory registry of agents currently being processed by QueryAgentExecutor.
 * Shared within the A2A server process — read by the heartbeat server.
 *
 * Also stores each agent's AbortController so cancelTask() can abort
 * the running query and kill its Claude Code subprocess via the signal.
 */

export type ProcessingTrigger = "scheduled" | "dove";

// Keyed by taskId
const active = new Map<string, ProcessingTrigger>();
const controllers = new Map<string, AbortController>();
// Reverse index: manifestKey → Set of active taskIds
const byManifest = new Map<string, Set<string>>();
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
  taskId: string,
  controller: AbortController,
  trigger: ProcessingTrigger,
): void {
  active.set(taskId, trigger);
  controllers.set(taskId, controller);
  if (!byManifest.has(manifestKey)) byManifest.set(manifestKey, new Set());
  byManifest.get(manifestKey)!.add(taskId);
  notifyListeners();
}

export function markIdle(manifestKey: string, taskId: string): void {
  active.delete(taskId);
  controllers.delete(taskId);
  const taskIds = byManifest.get(manifestKey);
  if (taskIds) {
    taskIds.delete(taskId);
    if (taskIds.size === 0) byManifest.delete(manifestKey);
  }
  notifyListeners();
}

export function isProcessing(manifestKey: string): boolean {
  return (byManifest.get(manifestKey)?.size ?? 0) > 0;
}

export function getProcessingTrigger(manifestKey: string): ProcessingTrigger | null {
  const taskIds = byManifest.get(manifestKey);
  if (!taskIds || taskIds.size === 0) return null;
  const firstTaskId = taskIds.values().next().value!;
  return active.get(firstTaskId) ?? null;
}

/**
 * Abort all running queries for this agent (kills tsx subprocess + claude CLI).
 * No-op if the agent is not currently processing.
 */
export function cancelProcessing(manifestKey: string): void {
  const taskIds = byManifest.get(manifestKey);
  if (!taskIds) return;
  for (const taskId of taskIds) {
    controllers.get(taskId)?.abort();
  }
}
