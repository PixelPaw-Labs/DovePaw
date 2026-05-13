"use client";

import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import type { Step } from "./use-swimlane-steps";

interface SwimlaneBubbleProps {
  step: Step;
  agentConfig?: AgentConfigEntry;
  isSelected: boolean;
  onSelect: (stepId: string) => void;
}

const STATUS_LABEL: Record<Step["status"], string> = {
  running: "Running",
  done: "Done",
  error: "Error",
};

export function SwimlaneBubble({ step, agentConfig, isSelected, onSelect }: SwimlaneBubbleProps) {
  const reduce = useReducedMotion();
  const def = agentConfig ? buildAgentDef(agentConfig) : null;
  const iconBg = step.status === "done" ? "bg-green-500" : (def?.iconBg ?? "bg-muted");

  const sizeClass =
    step.status === "running" ? "w-3.5 h-3.5" : isSelected ? "w-3.5 h-3.5" : "w-3 h-3";

  const ringClass =
    step.status === "error"
      ? "ring-2 ring-destructive/70"
      : isSelected
        ? "ring-2 ring-primary"
        : "ring-1 ring-border/40";

  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <motion.button
          type="button"
          layout
          data-status={step.status}
          data-step-id={step.id}
          aria-pressed={isSelected}
          aria-label={`${STATUS_LABEL[step.status]} step: ${step.preview}`}
          onClick={() => onSelect(step.id)}
          initial={reduce ? false : { scale: 0, y: 4, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 22 }}
          whileHover={reduce ? undefined : { scale: 1.25 }}
          className="relative inline-flex items-center justify-center shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
        >
          <span
            aria-hidden="true"
            className={`relative inline-block rounded-full ${iconBg} ${sizeClass} ${ringClass} transition-[width,height] duration-200`}
          />
          {step.status === "running" && (
            <span
              aria-hidden="true"
              className="absolute inset-0 rounded-full animate-[swimlane-pulse_2s_ease-in-out_infinite] pointer-events-none"
              style={{ backgroundColor: "currentColor" }}
            />
          )}
        </motion.button>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="w-72 text-xs">
        <div className="flex items-center gap-2 mb-1.5">
          {def?.icon ? (
            <span className={`w-5 h-5 rounded-md flex items-center justify-center ${def.iconBg}`}>
              <def.icon className={`w-3 h-3 ${def.iconColor ?? ""}`} />
            </span>
          ) : null}
          <span className="font-semibold">{def?.displayName ?? step.agentId}</span>
          <span
            className={`ml-auto text-[10px] font-bold uppercase tracking-wider ${
              step.status === "error"
                ? "text-destructive"
                : step.status === "running"
                  ? "text-primary"
                  : "text-muted-foreground"
            }`}
          >
            {STATUS_LABEL[step.status]}
          </span>
        </div>
        <p className="text-foreground/85 leading-relaxed whitespace-pre-wrap break-words">
          {step.fullText.slice(0, 200) || "—"}
          {step.fullText.length > 200 ? "…" : ""}
        </p>
        <p className="text-[10px] text-muted-foreground mt-2">Click to expand</p>
      </HoverCardContent>
    </HoverCard>
  );
}
