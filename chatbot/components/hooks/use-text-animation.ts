"use client";

import { useCallback, useRef } from "react";

// Chars to drain per 16ms tick — adaptive so rendering keeps up during fast bursts.
function charsPerTick(queueLength: number): number {
  if (queueLength > 400) return 20;
  if (queueLength > 150) return 8;
  if (queueLength > 40) return 4;
  return 1;
}

/**
 * Smooth character-drip animation for streaming text.
 * Decoupled from any message model — callers supply an onUpdate callback.
 */
export function useTextAnimation(onUpdate: (id: string, content: string) => void) {
  const pendingRef = useRef("");
  const displayedRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingIdRef = useRef("");

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stop();
    pendingRef.current = "";
    displayedRef.current = "";
  }, [stop]);

  const flush = useCallback(
    (id: string) => {
      stop();
      if (pendingRef.current.length === 0) return;
      displayedRef.current += pendingRef.current;
      pendingRef.current = "";
      onUpdate(id, displayedRef.current);
    },
    [stop, onUpdate],
  );

  const start = useCallback(
    (id: string) => {
      if (timerRef.current !== null) return;
      streamingIdRef.current = id;
      timerRef.current = setInterval(() => {
        if (pendingRef.current.length === 0) return;
        const n = charsPerTick(pendingRef.current.length);
        const chars = pendingRef.current.slice(0, n);
        pendingRef.current = pendingRef.current.slice(n);
        displayedRef.current += chars;
        onUpdate(streamingIdRef.current, displayedRef.current);
      }, 16);
    },
    [onUpdate],
  );

  const enqueue = useCallback(
    (id: string, chunk: string) => {
      pendingRef.current += chunk;
      start(id);
    },
    [start],
  );

  /**
   * Flush pending text into the current segment, emit a final update, then reset
   * the displayed buffer so the next text event writes into a fresh segment.
   */
  const cut = useCallback(
    (id: string) => {
      stop();
      if (pendingRef.current.length > 0) {
        displayedRef.current += pendingRef.current;
        pendingRef.current = "";
        onUpdate(id, displayedRef.current);
      }
      displayedRef.current = "";
    },
    [stop, onUpdate],
  );

  /**
   * Seed the animation state so new text continues from an already-displayed text.
   * Stops any running timer and primes displayedRef without triggering an update.
   */
  const seed = useCallback(
    (id: string, text: string) => {
      stop();
      streamingIdRef.current = id;
      displayedRef.current = text;
      pendingRef.current = "";
    },
    [stop],
  );

  return { enqueue, flush, reset, stop, cut, seed };
}
