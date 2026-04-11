"use client";

import * as React from "react";
import { animate } from "animejs";
import { PawPrint } from "lucide-react";

export function FloatingCatIcon() {
  const ref = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!ref.current) return () => {};
    const anim = animate(ref.current, {
      translateY: [-6, 6],
      duration: 2200,
      ease: "inOutSine",
      loop: true,
      alternate: true,
    });
    return () => {
      anim.cancel();
    };
  }, []);

  return (
    <span ref={ref} className="inline-block">
      <PawPrint className="w-16 h-16 text-primary/60" />
    </span>
  );
}
