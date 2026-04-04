"use client";

import { ThinkingDots } from "./thinking-dots";

interface ProcessingBarProps {
  count?: number;
  align?: "left" | "center";
}

export function ProcessingBar({ count = 5, align = "center" }: ProcessingBarProps) {
  return (
    <div className={`flex w-full py-2 ${align === "center" ? "justify-center" : "justify-start"}`}>
      <ThinkingDots count={count} />
    </div>
  );
}
