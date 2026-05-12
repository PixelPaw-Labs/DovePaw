"use client";

import * as React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { useGroupChatSession } from "@/components/hooks/use-group-chat-session";
import { GroupSwimlane, StepDetail, SwimlaneHeader, useSwimlaneSteps } from "./group-swimlane";

interface GroupChatViewProps {
  groupName: string;
  memberAgentIds: string[];
  agentConfigs: AgentConfigEntry[];
  onNewSession?: (fn: () => void) => void;
  onIsLoadingChange?: (loading: boolean) => void;
}

export function GroupChatView({
  groupName,
  memberAgentIds,
  agentConfigs,
  onNewSession,
  onIsLoadingChange,
}: GroupChatViewProps) {
  const { messages, isLoading, clearMessages } = useGroupChatSession(memberAgentIds, groupName);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  React.useEffect(() => {
    onNewSession?.(() => {
      clearMessages();
      setSelectedStepId(null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevIsLoadingRef = useRef(isLoading);
  useLayoutEffect(() => {
    if (prevIsLoadingRef.current !== isLoading) {
      prevIsLoadingRef.current = isLoading;
      onIsLoadingChange?.(isLoading);
    }
  }, [isLoading, onIsLoadingChange]);

  const model = useSwimlaneSteps(messages, memberAgentIds);
  const selectedStep = selectedStepId ? (model.stepById.get(selectedStepId) ?? null) : null;
  const selectedAgentConfig = selectedStep
    ? agentConfigs.find((a) => a.name === selectedStep.agentId)
    : undefined;

  const handleSelectStep = (stepId: string) => {
    setSelectedStepId((current) => (current === stepId ? null : stepId));
  };

  return (
    <main className="flex-1 flex flex-col bg-background relative min-w-0">
      <SwimlaneHeader
        groupName={groupName}
        memberAgentIds={memberAgentIds}
        agentConfigs={agentConfigs}
        activeAgentIds={model.activeAgentIds}
        totalSteps={model.stepById.size}
      />
      <GroupSwimlane
        model={model}
        memberAgentIds={memberAgentIds}
        agentConfigs={agentConfigs}
        selectedStepId={selectedStepId}
        onSelectStep={handleSelectStep}
      />
      <StepDetail
        step={selectedStep}
        agentConfig={selectedAgentConfig}
        onClose={() => setSelectedStepId(null)}
      />
    </main>
  );
}
