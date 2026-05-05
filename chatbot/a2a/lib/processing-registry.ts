/**
 * In-memory registry of agents currently being processed by QueryAgentExecutor.
 * Shared within the A2A server process.
 *
 * On every state change, writes PROCESSING_FILE so the /api/heartbeat SSE route
 * can read current processing state without a cross-process event bus.
 *
 * Also stores each agent's AbortController so cancelTask() can abort
 * the running query and kill its Claude Code subprocess via the signal.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { PROCESSING_FILE } from "@/lib/paths";

export type ProcessingTrigger = "scheduled" | "dove";

// Keyed by taskId
const active = new Map<string, ProcessingTrigger>();
const controllers = new Map<string, AbortController>();
// Reverse index: manifestKey → Set of active taskIds
const byManifest = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn();
  const state: Record<
    string,
    { processing: boolean; processingTrigger: ProcessingTrigger | null }
  > = {};
  for (const [manifestKey, taskIds] of byManifest) {
    const firstTaskId = taskIds.values().next().value!;
    state[manifestKey] = { processing: true, processingTrigger: active.get(firstTaskId) ?? null };
  }
  try {
    mkdirSync(dirname(PROCESSING_FILE), { recursive: true });
    writeFileSync(PROCESSING_FILE, JSON.stringify(state));
  } catch {
    // best-effort
  }
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
