/**
 * Server-side store for in-flight permission requests.
 *
 * When the PermissionRequest SDK hook fires, it creates a deferred promise here
 * and sends a "permission" SSE event to the browser. The POST /api/chat/permission
 * endpoint resolves the promise when the user approves or denies.
 *
 * Stored on globalThis so the Map survives Next.js HMR module re-evaluation in dev.
 * Without this, a file save between addPendingPermission and the user clicking Allow
 * would clear the Map and return 404 on the permission response.
 */

declare global {
  // eslint-disable-next-line no-var -- must use var for globalThis augmentation
  var __dovePendingPermissions: Map<string, (allowed: boolean) => void> | undefined;
}

const pending: Map<string, (allowed: boolean) => void> =
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- globalThis survives HMR; cast required since TS infers Map<any, any> for the global slot
  (globalThis.__dovePendingPermissions ??= new Map<string, (allowed: boolean) => void>()) as Map<
    string,
    (allowed: boolean) => void
  >;

/**
 * Register a pending permission request. Returns a Promise that resolves to
 * true (allowed) or false (denied) when the user responds.
 */
export function addPendingPermission(requestId: string): Promise<boolean> {
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
  });
}

/** Returns true if the requestId is still awaiting a user decision. */
export function hasPendingPermission(requestId: string): boolean {
  return pending.has(requestId);
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
