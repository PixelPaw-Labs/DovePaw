"use client";

import * as React from "react";
import { animate, createScope, createDraggable, createSpring, stagger } from "animejs";

interface UsePopupAnimationArgs {
  visible: boolean;
  sessionCount: number;
  dragWrapperRef: React.RefObject<HTMLDivElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function usePopupAnimation({
  visible,
  sessionCount,
  dragWrapperRef,
  panelRef,
  listRef,
  containerRef,
}: UsePopupAnimationArgs): void {
  const isFirstRender = React.useRef(true);
  const scopeRef = React.useRef<ReturnType<typeof createScope> | null>(null);

  // Set up draggable once on mount — container constrains drag to main area
  React.useEffect(() => {
    if (!dragWrapperRef.current || !containerRef.current) return () => {};
    const draggable = createDraggable(dragWrapperRef.current, {
      container: containerRef.current,
      releaseEase: createSpring({ stiffness: 180, damping: 18 }),
      cursor: { onHover: "grab", onGrab: "grabbing" },
    });
    return () => {
      draggable.revert();
    };
  }, [dragWrapperRef, containerRef]);

  // Animate panel in/out whenever visible changes (skip on initial mount)
  React.useEffect(() => {
    if (!panelRef.current) return () => {};
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return () => {};
    }
    const anim = visible
      ? animate(panelRef.current, {
          scale: [0.88, 1],
          opacity: [0, 1],
          translateY: [-10, 0],
          duration: 280,
          ease: "outExpo",
        })
      : animate(panelRef.current, {
          scale: [1, 0.88],
          opacity: [1, 0],
          translateY: [0, -10],
          duration: 200,
          ease: "inExpo",
        });
    return () => {
      anim.cancel();
    };
  }, [visible, panelRef]);

  // Stagger list items each time the popup opens
  React.useEffect(() => {
    if (!visible || !listRef.current || sessionCount === 0) return () => {};
    scopeRef.current?.revert();
    scopeRef.current = createScope({ root: listRef.current }).add(() => {
      animate(".session-row", {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 240,
        ease: "outExpo",
        delay: stagger(45),
      });
    });
    return () => {
      scopeRef.current?.revert();
      scopeRef.current = null;
    };
  }, [visible, sessionCount, listRef]);
}
