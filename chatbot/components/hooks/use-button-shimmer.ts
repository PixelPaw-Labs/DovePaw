"use client";

import { useRef, useEffect } from "react";
import { animate } from "animejs";

/**
 * Drives a sweeping shimmer overlay across a button using anime.js.
 * Attach the returned ref to a <span> that is:
 *   - absolute + full height inside the button
 *   - rendered only when isActive is true
 * The button itself must have `relative overflow-hidden`.
 */
export function useButtonShimmer(isActive: boolean) {
  const shimmerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = shimmerRef.current;
    if (!el || !isActive) return () => {};
    const anim = animate(el, {
      translateX: ["-100%", "300%"],
      duration: 3000,
      ease: "inOutSine",
      loop: true,
      loopDelay: 1200,
    });
    return () => {
      anim.pause();
    };
  }, [isActive]);

  return shimmerRef;
}
