"use client";

import * as React from "react";
import { useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageResponse } from "@/components/ai-elements/message";
import { MESSAGE_RESPONSE_SPACING } from "@/components/agent-chat/chat-message";
import { SwimlaneLane } from "./group-swimlane-lane";
import { HandoffOverlay } from "./group-swimlane-handoff";
import type { NarratorPill, SwimlaneModel } from "./use-swimlane-steps";

interface GroupSwimlaneProps {
  model: SwimlaneModel;
  memberAgentIds: string[];
  agentConfigs: AgentConfigEntry[];
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}

export function GroupSwimlane({
  model,
  memberAgentIds: _memberAgentIds,
  agentConfigs,
  selectedStepId,
  onSelectStep,
}: GroupSwimlaneProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const { lanes, handoffs, narratorPills } = model;

  const configByName = React.useMemo(
    () => new Map(agentConfigs.map((a) => [a.name, a])),
    [agentConfigs],
  );

  const { globalRankOf, totalSlots } = React.useMemo(() => {
    const allSteps = lanes.flatMap((l) => l.steps).toSorted((a, b) => a.index - b.index);
    const map = new Map<string, number>();
    allSteps.forEach((step, i) => map.set(step.id, i));
    return { globalRankOf: map, totalSlots: allSteps.length };
  }, [lanes]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {narratorPills.length > 0 && (
        <NarratorStrip pills={narratorPills} configByName={configByName} />
      )}
      <div className="relative flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        <div
          ref={gridRef}
          className="relative grid gap-y-2 w-full"
          style={{ gridTemplateColumns: "180px 1fr" }}
        >
          {lanes.map((lane) => (
            <SwimlaneLane
              key={lane.agentId}
              lane={lane}
              agentConfig={configByName.get(lane.agentId)}
              selectedStepId={selectedStepId}
              onSelectStep={onSelectStep}
              globalRankOf={globalRankOf}
              totalSlots={totalSlots}
            />
          ))}
          <HandoffOverlay containerRef={gridRef} handoffs={handoffs} />
        </div>
      </div>
    </div>
  );
}

function NarratorStrip({
  pills,
  configByName,
}: {
  pills: NarratorPill[];
  configByName: Map<string, AgentConfigEntry>;
}) {
  const reduce = useReducedMotion();
  const [openPillId, setOpenPillId] = useState<string | null>(null);
  const openPill = openPillId ? (pills.find((p) => p.id === openPillId) ?? null) : null;
  const openTarget = openPill?.targetAgent
    ? (configByName.get(openPill.targetAgent) ?? null)
    : null;
  const openTargetDef = openTarget ? buildAgentDef(openTarget) : null;

  return (
    <div className="px-6 py-3 border-b border-border/20 bg-muted/30">
      <div className="flex items-center gap-2 mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="w-3 h-3" />
        <span>Dove handoffs</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {pills.map((pill, i) => {
          const target = pill.targetAgent ? configByName.get(pill.targetAgent) : null;
          const targetDef = target ? buildAgentDef(target) : null;
          return (
            <motion.button
              key={pill.id}
              type="button"
              aria-label={`Open handoff message${targetDef ? ` to ${targetDef.displayName}` : ""}`}
              onClick={() => setOpenPillId(pill.id)}
              initial={reduce ? false : { y: 6, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              whileHover={reduce ? undefined : { y: -1 }}
              transition={
                reduce ? { duration: 0 } : { delay: i * 0.04, duration: 0.32, ease: "easeOut" }
              }
              className="flex items-center gap-2 max-w-md px-3 py-1.5 rounded-full bg-background/80 backdrop-blur-sm border border-border/40 text-xs text-left hover:border-primary/40 hover:bg-background transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="text-foreground/90 truncate">{pill.preview || "(handoff)"}</span>
              {targetDef && (
                <span className="flex items-center gap-1 shrink-0 pl-2 ml-1 border-l border-border/40">
                  <span
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center ${targetDef.iconBg}`}
                  >
                    <targetDef.icon className={`w-2 h-2 ${targetDef.iconColor ?? ""}`} />
                  </span>
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    {targetDef.displayName}
                  </span>
                </span>
              )}
            </motion.button>
          );
        })}
      </div>
      <Dialog open={!!openPill} onOpenChange={(o) => !o && setOpenPillId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="w-4 h-4 text-primary" />
              <span>Dove handoff</span>
              {openTargetDef && (
                <span className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border/40 text-xs font-normal text-muted-foreground">
                  to
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center ${openTargetDef.iconBg}`}
                  >
                    <openTargetDef.icon
                      className={`w-2.5 h-2.5 ${openTargetDef.iconColor ?? ""}`}
                    />
                  </span>
                  <span className="font-semibold text-foreground">{openTargetDef.displayName}</span>
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="text-sm leading-relaxed text-foreground/90 max-h-[60vh] overflow-y-auto">
            {openPill?.text ? (
              <MessageResponse className={MESSAGE_RESPONSE_SPACING}>
                {openPill.text}
              </MessageResponse>
            ) : (
              <span className="text-muted-foreground italic">(empty handoff)</span>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
