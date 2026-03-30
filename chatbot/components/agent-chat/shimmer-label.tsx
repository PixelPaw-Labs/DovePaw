"use client";

/**
 * ShimmerLabel — renders text with a sweeping shimmer animation when active,
 * or as a plain span when inactive.
 *
 * Used wherever a label should animate while something is in progress
 * (e.g. tool call badges, agent names in the sidebar).
 */

import { Shimmer } from "@/components/ai-elements/shimmer";
import type { ComponentProps } from "react";

export type ShimmerLabelProps = {
  children: string;
  isActive: boolean;
  className?: string;
  as?: ComponentProps<typeof Shimmer>["as"];
};

export function ShimmerLabel({
  children,
  isActive,
  className,
  as: Tag = "span",
}: ShimmerLabelProps) {
  if (isActive) {
    return (
      <Shimmer as={Tag} className={className}>
        {children}
      </Shimmer>
    );
  }
  return <Tag className={className}>{children}</Tag>;
}
