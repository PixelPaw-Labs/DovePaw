"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import { animate } from "animejs";
import { motion, useReducedMotion } from "motion/react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { SwimlaneBubble } from "./group-swimlane-bubble";
import type { Lane } from "./use-swimlane-steps";

interface SwimlaneLaneProps {
  lane: Lane;
  agentConfig?: AgentConfigEntry;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}

export function SwimlaneLane({
  lane,
  agentConfig,
  selectedStepId,
  onSelectStep,
}: SwimlaneLaneProps) {
  const reduce = useReducedMotion();
  const labelRef = useRef<HTMLDivElement>(null);
  const def = agentConfig ? buildAgentDef(agentConfig) : null;
  const Icon = def?.icon ?? null;
  const stepCount = lane.steps.length;

  useEffect(() => {
    if (reduce || !lane.isActive) return () => {};
    const el = labelRef.current;
    if (!el) return () => {};
    const anim = animate(el, {
      boxShadow: [
        "0 0 0 rgba(73, 97, 115, 0)",
        "0 0 18px rgba(73, 97, 115, 0.45)",
        "0 0 0 rgba(73, 97, 115, 0)",
      ],
      duration: 1800,
      ease: "inOutSine",
      loop: true,
    });
    return () => {
      anim.cancel();
      el.style.boxShadow = "";
    };
  }, [reduce, lane.isActive]);

  return (
    <motion.div
      layout
      data-lane={lane.agentId}
      data-active={lane.isActive ? "true" : "false"}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 28 }}
      className="contents"
    >
      <div
        ref={labelRef}
        className="sticky left-0 z-10 flex items-center gap-2.5 px-3 py-2 rounded-2xl bg-background/80 backdrop-blur-xl border border-border/20 min-h-14 transition-shadow"
      >
        {Icon ? (
          <span
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${def?.iconBg ?? "bg-muted"}`}
          >
            <Icon className={`w-4 h-4 ${def?.iconColor ?? ""}`} />
          </span>
        ) : (
          <span className="w-8 h-8 rounded-xl bg-muted shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground tracking-tight truncate">
            {def?.displayName ?? lane.agentId}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            {lane.isActive ? "Running" : stepCount === 0 ? "Idle" : `${stepCount} steps`}
          </p>
        </div>
      </div>

      <div
        className="relative flex items-center gap-3 px-3 py-2 min-h-14 overflow-x-auto overflow-y-hidden"
        role="list"
        aria-label={`${def?.displayName ?? lane.agentId} activity timeline`}
      >
        {stepCount === 0 ? (
          <span className="text-[11px] text-muted-foreground/60 italic">No activity yet</span>
        ) : (
          lane.steps.map((step) => (
            <SwimlaneBubble
              key={step.id}
              step={step}
              agentConfig={agentConfig}
              isSelected={selectedStepId === step.id}
              onSelect={onSelectStep}
            />
          ))
        )}
      </div>
    </motion.div>
  );
}
