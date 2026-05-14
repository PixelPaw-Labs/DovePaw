"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Handoff } from "./use-swimlane-steps";

interface HandoffOverlayProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  handoffs: Handoff[];
}

interface MeasuredPath {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  isLatest: boolean;
}

const ANIMATE_RECENT = 5;
const ARROW_PULLBACK = 9;

export function HandoffOverlay({ containerRef, handoffs }: HandoffOverlayProps) {
  const reduce = useReducedMotion();
  const [paths, setPaths] = useState<MeasuredPath[]>([]);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const animatedIdsRef = useRef(new Set<string>());

  const measure = React.useCallback(() => {
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const cutoff = Math.max(0, handoffs.length - ANIMATE_RECENT);
      const measured: MeasuredPath[] = [];
      handoffs.forEach((h, i) => {
        const from = container.querySelector<HTMLElement>(
          `[data-step-id="${CSS.escape(h.fromStepId)}"]`,
        );
        const to = container.querySelector<HTMLElement>(
          `[data-step-id="${CSS.escape(h.toStepId)}"]`,
        );
        if (!from || !to) return;
        const a = from.getBoundingClientRect();
        const b = to.getBoundingClientRect();
        measured.push({
          id: h.id,
          x1: a.left + a.width / 2 - rect.left,
          y1: a.top + a.height / 2 - rect.top,
          x2: b.left + b.width / 2 - rect.left,
          y2: b.top + b.height / 2 - rect.top,
          isLatest: i >= cutoff,
        });
      });
      setSize({ w: rect.width, h: rect.height });
      setPaths(measured);
    });
  }, [containerRef, handoffs]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return () => {};
    const obs = new ResizeObserver(() => measure());
    obs.observe(container);
    const scrollEls = container.querySelectorAll<HTMLElement>('[role="list"]');
    scrollEls.forEach((el) => el.addEventListener("scroll", measure, { passive: true }));
    return () => {
      obs.disconnect();
      scrollEls.forEach((el) => el.removeEventListener("scroll", measure));
    };
  }, [containerRef, measure]);

  if (paths.length === 0 || size.w === 0) return null;

  return (
    <svg
      data-handoff-overlay="true"
      className="absolute inset-0 pointer-events-none z-[5]"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="handoff-arrow"
          viewBox="0 0 6 6"
          refX="5"
          refY="3"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
        </marker>
      </defs>
      {paths.map((p) => {
        const mx = (p.x1 + p.x2) / 2;
        const dy = p.y2 - p.y1;
        const sag = Math.min(40, Math.max(16, Math.abs(dy) * 0.35));
        const cy = (p.y1 + p.y2) / 2 + (dy >= 0 ? -sag : sag);
        const tx = p.x2 - mx;
        const ty = p.y2 - cy;
        const tlen = Math.hypot(tx, ty) || 1;
        const ex = p.x2 - (tx / tlen) * ARROW_PULLBACK;
        const ey = p.y2 - (ty / tlen) * ARROW_PULLBACK;
        const d = `M ${p.x1} ${p.y1} Q ${mx} ${cy} ${ex} ${ey}`;
        const shouldAnimate = p.isLatest && !reduce && !animatedIdsRef.current.has(p.id);
        if (shouldAnimate) animatedIdsRef.current.add(p.id);
        return (
          <motion.path
            key={p.id}
            data-handoff={p.id}
            d={d}
            fill="none"
            stroke="currentColor"
            strokeWidth={p.isLatest ? 1.5 : 1}
            strokeLinecap="round"
            markerEnd="url(#handoff-arrow)"
            className={p.isLatest ? "text-primary/70" : "text-muted-foreground/25"}
            initial={shouldAnimate ? { pathLength: 0, opacity: 0 } : false}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={
              shouldAnimate
                ? {
                    pathLength: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
                    opacity: { duration: 0.15 },
                  }
                : { duration: 0 }
            }
          />
        );
      })}
    </svg>
  );
}
