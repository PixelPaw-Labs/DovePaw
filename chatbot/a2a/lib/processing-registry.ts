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

export function markProcessing(
  manifestKey: string,
  controller: AbortController,
  trigger: ProcessingTrigger,
): void {
  active.set(manifestKey, trigger);
  controllers.set(manifestKey, controller);
}

export function markIdle(manifestKey: string): void {
  active.delete(manifestKey);
  controllers.delete(manifestKey);
}

export function isProcessing(manifestKey: string): boolean {
  return active.has(manifestKey);
}

export function getProcessingTrigger(manifestKey: string): ProcessingTrigger | null {
  return active.get(manifestKey) ?? null;
}
