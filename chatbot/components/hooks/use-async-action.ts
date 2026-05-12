"use client";

import * as React from "react";

/**
 * Wraps an async action with a `pending` flag so a button can render a
 * spinner / disabled state without each call site reimplementing the
 * mount-tracking + concurrent-click guard.
 *
 * Concurrent calls while pending are no-ops — the same in-flight promise
 * is implied; we don't trigger the action twice. `pending` resets to false
 * after the action settles (resolve or reject).
 */
export function useAsyncAction(action: () => void | Promise<void>): {
  pending: boolean;
  trigger: () => Promise<void>;
} {
  const [pending, setPending] = React.useState(false);
  const mountedRef = React.useRef(true);
  const pendingRef = React.useRef(false);
  const actionRef = React.useRef(action);
  React.useEffect(() => {
    actionRef.current = action;
  }, [action]);
  React.useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const trigger = React.useCallback(async (): Promise<void> => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await actionRef.current();
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
    }
  }, []);

  return { pending, trigger };
}
