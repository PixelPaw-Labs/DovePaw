/**
 * Minimal structural shape of the Electron objects tab teardown touches —
 * kept dependency-free so the teardown sequence is unit-testable without an
 * Electron runtime.
 */
export interface TeardownView {
  webContents: {
    debugger: { detach: () => void };
    isDestroyed: () => boolean;
    close: () => void;
  };
}

/**
 * Tears down a browser tab's renderer: detaches the CDP debugger, removes the
 * view from its parent, and closes the webContents.
 *
 * The close() call is the load-bearing line: removeChildView plus dropping the
 * map reference only lets GC eventually reclaim the WebContentsView, leaving the
 * renderer process (tens of MB) alive until then. Closing it reclaims the
 * renderer promptly. Mirrors the isDestroyed() guard used by the standalone
 * agent-browser so a double close is a no-op.
 */
export function teardownTab<V extends TeardownView>(
  view: V,
  removeChildView: (v: V) => void,
): void {
  try {
    view.webContents.debugger.detach();
  } catch {
    /* already detached */
  }
  try {
    removeChildView(view);
  } catch {
    /* not attached */
  }
  if (!view.webContents.isDestroyed()) view.webContents.close();
}
