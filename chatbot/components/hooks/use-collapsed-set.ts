"use client";

import * as React from "react";

/**
 * Per-key collapse/expand state. Used for fold/unfold sections grouped by a
 * stable key (e.g. GitHub owner). Keys default to expanded; calling `toggle`
 * flips them into the collapsed set.
 */
export function useCollapsedSet(initialCollapsed: readonly string[] = []): {
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
} {
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set(initialCollapsed));
  const toggle = React.useCallback((key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const isCollapsed = React.useCallback((key: string): boolean => collapsed.has(key), [collapsed]);
  return { isCollapsed, toggle };
}
