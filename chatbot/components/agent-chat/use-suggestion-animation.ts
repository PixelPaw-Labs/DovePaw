"use client";

import * as React from "react";
import { animate, createScope, stagger } from "animejs";

export function useSuggestionAnimation() {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const scopeRef = React.useRef<ReturnType<typeof createScope> | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return () => {};
    scopeRef.current = createScope({ root: containerRef.current }).add(() => {
      animate(".suggestion-card", {
        opacity: [0, 1],
        translateY: [10, 0],
        duration: 200,
        delay: stagger(60),
        ease: "outQuad",
      });
    });
    return () => scopeRef.current?.revert();
  }, []);

  return containerRef;
}
