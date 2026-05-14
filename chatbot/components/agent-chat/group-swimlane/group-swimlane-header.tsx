"use client";

import * as React from "react";
import { Users2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { isDove } from "./swimlane-buckets";

type AgentTaskStatus = "running" | "completed" | "failed" | "canceled" | "rejected";

interface SwimlaneHeaderProps {
  groupName: string;
  memberAgentIds: string[];
  agentConfigs: AgentConfigEntry[];
  activeAgentIds: Set<string>;
  totalSteps: number;
  agentStatuses?: Map<string, AgentTaskStatus>;
}

export function SwimlaneHeader({
  groupName,
  memberAgentIds,
  agentConfigs,
  activeAgentIds,
  totalSteps,
  agentStatuses,
}: SwimlaneHeaderProps) {
  const reduce = useReducedMotion();
  const configByName = React.useMemo(
    () => new Map(agentConfigs.map((a) => [a.name, a])),
    [agentConfigs],
  );
  const visibleMembers = memberAgentIds.filter((id) => !isDove(id));
  const activeCount = activeAgentIds.size;

  return (
    <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center gap-3 w-full px-6 py-2.5 shrink-0">
      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
        <Users2 className="w-4 h-4 text-primary" />
      </div>
      <h1 className="text-base font-bold text-foreground tracking-tight">{groupName}</h1>
      <span className="px-2.5 py-0.5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground tracking-wider uppercase">
        Live
      </span>

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span>
            <span className="text-foreground tabular-nums">{totalSteps}</span> steps
          </span>
          <span className="h-3 w-px bg-border/60" aria-hidden="true" />
          <span className="flex items-center gap-1.5">
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full ${
                activeCount > 0 ? "bg-primary" : "bg-muted-foreground/50"
              }`}
              aria-hidden="true"
            />
            <span className={activeCount > 0 ? "text-primary" : ""}>
              {activeCount > 0 ? `${activeCount} active` : "Idle"}
            </span>
          </span>
        </div>
        <div className="flex -space-x-1">
          {visibleMembers.map((agentId) => {
            const config = configByName.get(agentId);
            if (!config) return null;
            const { icon: Icon, iconBg, iconColor, displayName } = buildAgentDef(config);
            const isActive = activeAgentIds.has(agentId);
            const status = agentStatuses?.get(agentId);
            const isRunning = status === "running";
            const isCompleted = status === "completed";
            const isError = status === "failed" || status === "canceled" || status === "rejected";
            return (
              <div key={agentId} className="relative shrink-0">
                {isRunning && (
                  <motion.div
                    className="absolute inset-0 rounded-md border-2 border-transparent border-t-primary pointer-events-none"
                    animate={reduce ? {} : { rotate: 360 }}
                    transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                    aria-hidden="true"
                  />
                )}
                {isCompleted && (
                  <div
                    className="absolute inset-0 rounded-md border-2 border-green-500/70 pointer-events-none"
                    aria-hidden="true"
                  />
                )}
                {isError && (
                  <div
                    className="absolute inset-0 rounded-md border-2 border-destructive/70 pointer-events-none"
                    aria-hidden="true"
                  />
                )}
                <motion.div
                  layout
                  transition={
                    reduce ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 26 }
                  }
                  title={displayName}
                  className={`w-6 h-6 rounded-md flex items-center justify-center ring-2 ring-background ${iconBg} ${
                    isActive || isRunning ? "shadow-[0_0_0_2px_rgb(73_97_115_/_0.6)]" : ""
                  }`}
                >
                  <Icon className={`w-3 h-3 ${iconColor}`} />
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </header>
  );
}
