"use client";

import * as React from "react";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { PluginRecord } from "@@/lib/plugin-schemas";
import type { DoveSettings } from "@@/lib/settings-schemas";
import { AgentSidebar } from "@/components/agent-chat/agent-sidebar";
import { AgentChat } from "@/components/agent-chat";
import { ConversationProvider } from "@/components/hooks/use-conversation-context";

interface ChatAppProps {
  agentConfigs: AgentConfigEntry[];
  tmpAgentConfigs?: AgentConfigEntry[];
  plugins?: readonly Pick<PluginRecord, "path" | "name">[];
  initialDoveSettings?: DoveSettings;
}

export function ChatApp({
  agentConfigs,
  tmpAgentConfigs = [],
  plugins = [],
  initialDoveSettings,
}: ChatAppProps) {
  const [activeAgentId, setActiveAgentId] = React.useState("dove");
  const [isLoading, setIsLoading] = React.useState(false);
  const [doveIsRunning, setDoveIsRunning] = React.useState(false);
  const newSessionRef = React.useRef<(() => void) | null>(null);

  const handleClearAllHistory = React.useCallback(async () => {
    await fetch("/api/sessions/all", { method: "DELETE" });
    newSessionRef.current?.();
  }, []);

  const handleSelectAgent = React.useCallback((agentId: string) => {
    setActiveAgentId(agentId);
    setIsLoading(false);
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
          tmpAgentConfigs={tmpAgentConfigs}
          plugins={plugins}
          initialDoveSettings={initialDoveSettings}
          onSelectAgent={handleSelectAgent}
          activeAgentId={activeAgentId}
          onClearAllHistory={handleClearAllHistory}
        />
        <AgentChat
          key={activeAgentId}
          agentId={activeAgentId}
          agentConfigs={[...agentConfigs, ...tmpAgentConfigs]}
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
