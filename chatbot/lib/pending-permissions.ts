/**
 * Server-side store for in-flight permission requests.
 *
 * When the PermissionRequest SDK hook fires, it creates a deferred promise here
 * and sends a "permission" SSE event to the browser. The POST /api/chat/permission
 * endpoint resolves the promise when the user approves or denies.
 *
 * Stored in module scope (singleton per process) — safe for Next.js server-side use
 * because route.ts and the API endpoint share the same Node.js process.
 */

const pending = new Map<string, (allowed: boolean) => void>();

/**
 * Register a pending permission request. Returns a Promise that resolves to
 * true (allowed) or false (denied) when the user responds.
 */
export function addPendingPermission(requestId: string): Promise<boolean> {
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
  });
}

/**
 * Resolve a pending permission request. Returns false if the requestId is unknown.
 */
export function resolvePendingPermission(requestId: string, allowed: boolean): boolean {
  const resolve = pending.get(requestId);
  if (!resolve) return false;
  pending.delete(requestId);
  resolve(allowed);
  return true;
}

/**
 * Deny and clean up a specific set of pending permissions (called on session
 * abort/cancel to avoid hanging hooks for that request only).
 */
export function abortPendingPermissions(requestIds: Set<string>): void {
  for (const id of requestIds) {
    const resolve = pending.get(id);
    if (resolve) {
      pending.delete(id);
      resolve(false);
    }
  }
}
