import { useMemo } from "react";
import { messageText, type ChatMessage } from "@/components/hooks/use-messages";
import { bucketOf, isDove, USER_BUCKET } from "./swimlane-buckets";

export type StepStatus = "running" | "done" | "error";

export interface Step {
  id: string;
  agentId: string;
  index: number;
  status: StepStatus;
  preview: string;
  fullText: string;
}

export interface Lane {
  agentId: string;
  steps: Step[];
  isActive: boolean;
}

export interface Handoff {
  id: string;
  fromAgent: string;
  toAgent: string;
  fromStepId: string;
  toStepId: string;
}

export interface NarratorPill {
  id: string;
  text: string;
  preview: string;
  targetAgent?: string;
  index: number;
}

export interface SwimlaneModel {
  lanes: Lane[];
  handoffs: Handoff[];
  narratorPills: NarratorPill[];
  activeAgentIds: Set<string>;
  stepById: Map<string, Step>;
}

const PREVIEW_LIMIT = 80;

function clip(text: string, limit: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) return collapsed;
  return collapsed.slice(0, limit - 1).trimEnd() + "…";
}

function statusOf(msg: ChatMessage, fullText: string): StepStatus {
  if (msg.isLoading) return "running";
  if (fullText.trimStart().startsWith("⚠️")) return "error";
  return "done";
}

/**
 * Derive lanes + handoffs + narrator pills from the flat group-chat messages.
 * Dove-authored assistant messages do not get their own lane — Dove's
 * sender-style instructions surface as narrator pills above the lanes.
 */
export function useSwimlaneSteps(messages: ChatMessage[], memberAgentIds: string[]): SwimlaneModel {
  return useMemo(() => {
    const memberSet = new Set(memberAgentIds.filter((id) => !isDove(id)));

    const lanesByAgent = new Map<string, Step[]>();
    for (const id of memberSet) lanesByAgent.set(id, []);

    const handoffs: Handoff[] = [];
    const narratorPills: NarratorPill[] = [];
    const activeAgentIds = new Set<string>();
    const stepById = new Map<string, Step>();

    let lastBucket: string | null = null;
    let lastStepInBucket = new Map<string, Step>();

    messages.forEach((msg, index) => {
      const bucket = bucketOf(msg);

      // Dove orchestration handoffs: user-role msg with senderAgentId === dove
      if (msg.role === "user" && msg.senderAgentId && isDove(msg.senderAgentId)) {
        const fullText = messageText(msg);
        narratorPills.push({
          id: msg.id,
          text: fullText,
          preview: clip(fullText, 120),
          index,
        });
        return;
      }

      // Skip plain user messages (we are view-only; no human input in group view)
      if (bucket === USER_BUCKET) return;

      // Skip Dove-authored assistant content entirely
      if (isDove(bucket)) return;

      // Lazily ensure a lane exists even if the member wasn't in memberAgentIds
      if (!lanesByAgent.has(bucket)) lanesByAgent.set(bucket, []);

      const fullText = messageText(msg);
      const status = statusOf(msg, fullText);
      const step: Step = {
        id: msg.id,
        agentId: bucket,
        index,
        status,
        preview: clip(fullText, PREVIEW_LIMIT) || "…",
        fullText,
      };

      lanesByAgent.get(bucket)!.push(step);
      stepById.set(step.id, step);
      if (status === "running") activeAgentIds.add(bucket);

      // Detect a handoff: previous non-Dove bucket was different from current
      if (lastBucket && lastBucket !== bucket && !isDove(lastBucket)) {
        const fromStep = lastStepInBucket.get(lastBucket);
        if (fromStep) {
          handoffs.push({
            id: `${fromStep.id}->${step.id}`,
            fromAgent: lastBucket,
            toAgent: bucket,
            fromStepId: fromStep.id,
            toStepId: step.id,
          });
        }
      }

      lastBucket = bucket;
      lastStepInBucket.set(bucket, step);
    });

    // Bind narrator pills to their next-emerging target agent for the chip
    let pillIdx = 0;
    for (const pill of narratorPills) {
      for (let i = pillIdx; i < messages.length; i++) {
        if (messages[i].id === pill.id) {
          for (let j = i + 1; j < messages.length; j++) {
            const nextBucket = bucketOf(messages[j]);
            if (nextBucket !== USER_BUCKET && !isDove(nextBucket)) {
              pill.targetAgent = nextBucket;
              break;
            }
          }
          pillIdx = i + 1;
          break;
        }
      }
    }

    const orderedMembers = [
      ...memberAgentIds.filter((id) => !isDove(id) && lanesByAgent.has(id)),
      ...[...lanesByAgent.keys()].filter((id) => !memberAgentIds.includes(id)),
    ];

    const lanes: Lane[] = orderedMembers.map((agentId) => ({
      agentId,
      steps: lanesByAgent.get(agentId) ?? [],
      isActive: activeAgentIds.has(agentId),
    }));

    return { lanes, handoffs, narratorPills, activeAgentIds, stepById };
  }, [messages, memberAgentIds]);
}
