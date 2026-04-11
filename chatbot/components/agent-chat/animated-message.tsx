"use client";

import * as React from "react";
import { animate } from "animejs";
import { Message } from "@/components/ai-elements/message";

export function AnimatedMessage({
  children,
  from,
  ...props
}: {
  children: React.ReactNode;
  from: "user" | "assistant";
} & React.HTMLAttributes<HTMLDivElement>) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!wrapperRef.current) return () => {};
    const anim = animate(wrapperRef.current, {
      translateY: [10, 0],
      opacity: [0, 1],
      duration: 450,
      ease: "outExpo",
    });
    return () => {
      anim.cancel();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="opacity-0 w-full">
      <Message from={from} {...props}>
        {children}
      </Message>
    </div>
  );
}
