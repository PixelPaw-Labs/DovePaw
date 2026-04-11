"use client";

import * as React from "react";
import { animate } from "animejs";

const PERIOD = 48;
const EKG = `M0,8 L8,8 L10,5 L12,8 L13,1 L15,15 L16,8 L20,8 L22,5 L24,8 L32,8`;

export function HeartbeatLine() {
  const groupRef = React.useRef<SVGGElement>(null);

  React.useEffect(() => {
    if (!groupRef.current) return () => {};
    const anim = animate(groupRef.current, {
      translateX: [0, -PERIOD],
      duration: 1000,
      ease: "linear",
      loop: true,
    });
    return () => {
      anim.pause();
    };
  }, []);

  return (
    <svg
      width={PERIOD}
      height={16}
      viewBox={`0 0 ${PERIOD} 16`}
      className="overflow-hidden"
      style={{ display: "block" }}
    >
      <g ref={groupRef}>
        {[0, PERIOD, PERIOD * 2].map((dx) => (
          <path
            key={dx}
            d={EKG}
            transform={`translate(${dx}, 0)`}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}
