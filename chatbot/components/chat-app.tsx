"use client";

import * as React from "react";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { AgentId } from "@/lib/agent-api-urls";
import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import { AgentChat } from "@/components/agent-chat";
import { ConversationProvider } from "@/components/hooks/use-conversation-context";

interface ChatAppProps {
  agentConfigs: AgentConfigEntry[];
}

export function ChatApp({ agentConfigs }: ChatAppProps) {
  const [activeAgentId, setActiveAgentId] = React.useState<AgentId>("dove");
  const [isLoading, setIsLoading] = React.useState(false);
  const [doveIsRunning, setDoveIsRunning] = React.useState(false);
  const newSessionRef = React.useRef<(() => void) | null>(null);

  const handleClearAllHistory = React.useCallback(async () => {
    await fetch("/api/sessions/all", { method: "DELETE" });
    newSessionRef.current?.();
  }, []);

  return (
    <ConversationProvider
      isLoading={isLoading}
      activeAgentId={activeAgentId}
      doveIsRunning={doveIsRunning}
    >
      <div className="flex h-screen bg-background overflow-hidden">
        <AgentSidebar
          agentConfigs={agentConfigs}
          onSelectAgent={setActiveAgentId}
          activeAgentId={activeAgentId}
          onClearAllHistory={handleClearAllHistory}
        />
        <AgentChat
          key={activeAgentId}
          agentId={activeAgentId}
          agentConfigs={agentConfigs}
          onIsLoadingChange={(loading) => {
            setIsLoading(loading);
            if (activeAgentId === "dove") setDoveIsRunning(loading);
          }}
          onNewSession={(fn) => {
            newSessionRef.current = fn;
          }}
        />
      </div>
    </ConversationProvider>
  );
}
