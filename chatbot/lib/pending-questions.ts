/**
 * Server-side store for in-flight AskUserQuestion requests.
 *
 * When Claude calls the AskUserQuestion tool the canUseTool callback creates a
 * deferred promise here and sends a "question" SSE event to the browser. The
 * POST /api/chat/question endpoint resolves the promise with the user's answers.
 *
 * Stored on globalThis so the Map survives Next.js HMR module re-evaluation in dev.
 */

declare global {
  // eslint-disable-next-line no-var -- must use var for globalThis augmentation
  var __dovePendingQuestions: Map<string, (answers: Record<string, string>) => void> | undefined;
}

const pending: Map<string, (answers: Record<string, string>) => void> =
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- globalThis survives HMR; cast required since TS infers Map<any, any> for the global slot
  (globalThis.__dovePendingQuestions ??= new Map<
    string,
    (answers: Record<string, string>) => void
  >()) as Map<string, (answers: Record<string, string>) => void>;

/**
 * Register a pending question request. Returns a Promise that resolves with
 * the user's answers map (question text → selected label).
 */
export function addPendingQuestion(requestId: string): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
  });
}

/** Returns true if the requestId is still awaiting a user answer. */
export function hasPendingQuestion(requestId: string): boolean {
  return pending.has(requestId);
}

/**
 * Resolve a pending question request with the user's answers.
 * Returns false if the requestId is unknown.
 */
export function resolvePendingQuestion(
  requestId: string,
  answers: Record<string, string>,
): boolean {
  const resolve = pending.get(requestId);
  if (!resolve) return false;
  pending.delete(requestId);
  resolve(answers);
  return true;
}

/**
 * Abort and clean up a specific set of pending questions (called on session
 * abort/cancel to avoid hanging hooks for that request only).
 * Resolves with empty answers so the SDK can continue gracefully.
 */
export function abortPendingQuestions(requestIds: Set<string>): void {
  for (const id of requestIds) {
    const resolve = pending.get(id);
    if (resolve) {
      pending.delete(id);
      resolve({});
    }
  }
}
