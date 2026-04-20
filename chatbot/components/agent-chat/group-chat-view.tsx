"use client";

import * as React from "react";
import { Users2 } from "lucide-react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { Conversation, ConversationContent } from "@/components/ai-elements/conversation";
import { ChatMessageItem } from "./chat-message";
import { ChatInputBar } from "./chat-input-bar";
import { ProcessingBar } from "./processing-bar";
import { useGroupChatSession } from "@/components/hooks/use-group-chat-session";

interface GroupChatViewProps {
  groupName: string;
  memberAgentIds: string[];
  agentConfigs: AgentConfigEntry[];
  onNewSession?: (fn: () => void) => void;
}

export function GroupChatView({
  groupName,
  memberAgentIds,
  agentConfigs,
  onNewSession,
}: GroupChatViewProps) {
  const { messages, isLoading, sendToAgent, clearMessages } = useGroupChatSession(
    memberAgentIds,
    groupName,
  );

  React.useEffect(() => {
    onNewSession?.(clearMessages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [selectedAgentId, setSelectedAgentId] = React.useState(memberAgentIds[0] ?? "");

  const configByName = React.useMemo(
    () => new Map(agentConfigs.map((a) => [a.name, a])),
    [agentConfigs],
  );
  const displayName = (agentId: string) => configByName.get(agentId)?.displayName ?? agentId;

  const handleSubmit = (text: string) => {
    if (selectedAgentId) void sendToAgent(selectedAgentId, text);
  };

  return (
    <main className="flex-1 flex flex-col bg-background relative min-w-0">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center gap-3 w-full px-6 py-2.5 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
          <Users2 className="w-4 h-4 text-primary" />
        </div>
        <h1 className="text-base font-bold text-foreground tracking-tight">{groupName}</h1>
        <span className="px-2.5 py-0.5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground tracking-wider uppercase">
          Group Chat
        </span>

        <div className="flex -space-x-1 ml-auto">
          {memberAgentIds.map((agentId) => {
            const config = configByName.get(agentId);
            if (!config) return null;
            const { icon: Icon, iconBg, iconColor, displayName: name } = buildAgentDef(config);
            return (
              <div
                key={agentId}
                title={name}
                className={`w-6 h-6 rounded-md shrink-0 flex items-center justify-center ring-2 ring-background ${iconBg}`}
              >
                <Icon className={`w-3 h-3 ${iconColor}`} />
              </div>
            );
          })}
        </div>
      </header>

      <Conversation className="flex-1 bg-background">
        <ConversationContent>
          {messages.length === 0 && !isLoading ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-sm text-muted-foreground">
                No messages yet. Start the conversation.
              </p>
            </div>
          ) : (
            messages.map((msg, i) => {
              const prevMsg = messages[i - 1];
              const showLabel =
                msg.agentId &&
                (msg.role === "user" ||
                  (msg.role === "assistant" &&
                    !(prevMsg?.role === "assistant" && prevMsg?.agentId === msg.agentId)));

              if (!showLabel) {
                return (
                  <ChatMessageItem
                    key={msg.id}
                    msg={msg}
                    agentConfigs={agentConfigs}
                    hideReasoning
                    hideAvatars
                  />
                );
              }

              const isUser = msg.role === "user";
              const senderAgentId = isUser ? msg.senderAgentId : msg.agentId;
              const agentConfig = senderAgentId ? configByName.get(senderAgentId) : null;
              const {
                icon: AgentIcon,
                iconBg,
                iconColor,
              } = agentConfig
                ? buildAgentDef(agentConfig)
                : { icon: Users2, iconBg: "bg-muted", iconColor: "text-muted-foreground" };
              return (
                <div key={msg.id} className="flex flex-col gap-1">
                  <div className={`flex items-center gap-2 ${isUser ? "justify-end" : ""}`}>
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}
                    >
                      <AgentIcon className={`w-5 h-5 ${iconColor}`} />
                    </div>
                    <span className="text-base font-semibold text-foreground">
                      {senderAgentId ? displayName(senderAgentId) : ""}
                    </span>
                  </div>
                  <ChatMessageItem
                    msg={msg}
                    agentConfigs={agentConfigs}
                    hideReasoning
                    hideAvatars
                  />
                </div>
              );
            })
          )}
          {isLoading && <ProcessingBar />}
        </ConversationContent>
      </Conversation>

      <footer className="px-6 pb-4 pt-2 w-full max-w-5xl mx-auto shrink-0">
        {memberAgentIds.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {memberAgentIds.map((agentId) => {
              const config = configByName.get(agentId);
              const isSelected = agentId === selectedAgentId;
              const {
                icon: Icon,
                iconBg,
                iconColor,
              } = config
                ? buildAgentDef(config)
                : { icon: Users2, iconBg: "bg-muted", iconColor: "text-muted-foreground" };
              return (
                <button
                  key={agentId}
                  onClick={() => setSelectedAgentId(agentId)}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    isSelected
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center ${isSelected ? "bg-primary/20" : iconBg}`}
                  >
                    <Icon className={`w-2 h-2 ${isSelected ? "text-primary" : iconColor}`} />
                  </div>
                  {displayName(agentId)}
                </button>
              );
            })}
          </div>
        )}

        <ChatInputBar
          onSubmit={handleSubmit}
          onCancel={() => {}}
          isLoading={isLoading}
          pendingQueue={[]}
          onRemoveFromQueue={() => {}}
        />
        <p className="text-center mt-3 text-[10px] text-muted-foreground/40 font-medium tracking-widest uppercase">
          Secured by Dove&apos;s whiskers
        </p>
      </footer>

      <div className="fixed top-0 right-0 w-1/3 h-full bg-linear-to-l from-primary/5 to-transparent pointer-events-none z-0" />
      <div className="fixed bottom-0 left-0 w-1/2 h-1/2 bg-linear-to-tr from-accent/10 to-transparent pointer-events-none z-0" />
    </main>
  );
}
