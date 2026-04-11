"use client";

import * as React from "react";
import { createScope, createTimeline, stagger } from "animejs";

export function ThinkingDots({ count = 3 }: { count?: number }) {
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const scopeRef = React.useRef<ReturnType<typeof createScope> | null>(null);
  const staggerMs = Math.round(360 / count);

  React.useEffect(() => {
    if (!containerRef.current) return () => {};
    scopeRef.current = createScope({ root: containerRef.current }).add(() => {
      createTimeline({ loop: true, defaults: { ease: "inOutSine" } })
        .add(".thinking-dot", { translateY: [0, -4], duration: 350, delay: stagger(staggerMs) })
        .add(".thinking-dot", { translateY: [-4, 0], duration: 350, delay: stagger(staggerMs) });
    });
    return () => scopeRef.current?.revert();
  }, [staggerMs]);

  return (
    <span ref={containerRef} className="flex gap-1 items-center py-1 px-1">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="thinking-dot w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
      ))}
    </span>
  );
}
