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
  globalRankOf: Map<string, number>;
  totalSlots: number;
}

export function SwimlaneLane({
  lane,
  agentConfig,
  selectedStepId,
  onSelectStep,
  globalRankOf,
  totalSlots,
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
        className="relative h-14 overflow-x-auto overflow-y-hidden"
        role="list"
        aria-label={`${def?.displayName ?? lane.agentId} activity timeline`}
      >
        <div className="relative h-full" style={{ minWidth: 12 + totalSlots * 28 }}>
          {stepCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-px"
              style={{
                background:
                  "linear-gradient(to right, transparent, var(--color-border) 12px, var(--color-border) calc(100% - 12px), transparent)",
                opacity: 0.35,
              }}
            />
          )}
          {stepCount === 0 ? (
            <span className="absolute inset-0 flex items-center px-3 text-[11px] text-muted-foreground/60 italic">
              No activity yet
            </span>
          ) : (
            lane.steps.map((step) => {
              const rank = globalRankOf.get(step.id) ?? 0;
              return (
                <span
                  key={step.id}
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-6"
                  style={{ left: 12 + rank * 28 }}
                >
                  <SwimlaneBubble
                    step={step}
                    agentConfig={agentConfig}
                    isSelected={selectedStepId === step.id}
                    onSelect={onSelectStep}
                  />
                </span>
              );
            })
          )}
        </div>
      </div>
    </motion.div>
  );
}
