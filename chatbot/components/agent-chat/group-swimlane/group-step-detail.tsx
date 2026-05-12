"use client";

import * as React from "react";
import { X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { MessageResponse } from "@/components/ai-elements/message";
import { MESSAGE_RESPONSE_SPACING } from "@/components/agent-chat/chat-message";
import type { Step } from "./use-swimlane-steps";

interface StepDetailProps {
  step: Step | null;
  agentConfig?: AgentConfigEntry;
  onClose: () => void;
}

const STATUS_LABEL: Record<Step["status"], string> = {
  running: "Running",
  done: "Done",
  error: "Error",
};

export function StepDetail({ step, agentConfig, onClose }: StepDetailProps) {
  const reduce = useReducedMotion();
  const def = agentConfig ? buildAgentDef(agentConfig) : null;
  const Icon = def?.icon ?? null;

  return (
    <AnimatePresence initial={false}>
      {step ? (
        <motion.section
          key={step.id}
          data-step-detail={step.id}
          initial={reduce ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={reduce ? { duration: 0 } : { duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden border-t border-border/30 bg-card/60 backdrop-blur-sm"
        >
          <div className="px-6 py-4 max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-3">
              {Icon ? (
                <span
                  className={`w-8 h-8 rounded-xl flex items-center justify-center ${def?.iconBg ?? "bg-muted"}`}
                >
                  <Icon className={`w-4 h-4 ${def?.iconColor ?? ""}`} />
                </span>
              ) : null}
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight">
                  {def?.displayName ?? step.agentId}
                </p>
                <p
                  className={`text-[10px] uppercase tracking-wider font-bold ${
                    step.status === "error"
                      ? "text-destructive"
                      : step.status === "running"
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {STATUS_LABEL[step.status]}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close step detail"
                className="ml-auto w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-sm leading-relaxed text-foreground/90 max-h-72 overflow-y-auto">
              {step.fullText ? (
                <MessageResponse className={MESSAGE_RESPONSE_SPACING}>
                  {step.fullText}
                </MessageResponse>
              ) : (
                <span className="text-muted-foreground italic">—</span>
              )}
            </div>
          </div>
        </motion.section>
      ) : null}
    </AnimatePresence>
  );
}
