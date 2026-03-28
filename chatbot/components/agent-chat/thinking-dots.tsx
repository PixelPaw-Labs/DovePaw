"use client";

import * as React from "react";
import { createScope, createTimeline, stagger } from "animejs";

export function ThinkingDots() {
  const containerRef = React.useRef<HTMLSpanElement>(null);
  const scopeRef = React.useRef<ReturnType<typeof createScope> | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    scopeRef.current = createScope({ root: containerRef.current }).add(() => {
      createTimeline({ loop: true, defaults: { ease: "inOutSine" } })
        .add(".thinking-dot", { translateY: [0, -4], duration: 350, delay: stagger(120) })
        .add(".thinking-dot", { translateY: [-4, 0], duration: 350, delay: stagger(120) });
    });
    return () => scopeRef.current?.revert();
  }, []);

  return (
    <span ref={containerRef} className="flex gap-1 items-center py-1 px-1">
      {[0, 1, 2].map((i) => (
        <span key={i} className="thinking-dot w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
      ))}
    </span>
  );
}
