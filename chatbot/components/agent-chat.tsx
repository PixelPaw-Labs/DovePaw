"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Bot, Settings, Trash2 } from "lucide-react";
import { AGENTS } from "@@/lib/agents";
import { USER_AVATAR } from "@/lib/avatars";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ChatInputBar } from "./agent-chat/chat-input-bar";
import { useConversations } from "@/components/hooks/use-conversations";
import { AgentSidebar } from "./agent-chat/agent-sidebar";
import { ChatMessageItem } from "./agent-chat/chat-message";
import { IntroCard } from "./agent-chat/intro-card";

function useActiveAgentLabel(activeAgentId: string) {
  if (activeAgentId === "dove") return { name: "Dove", Icon: Bot };
  const agent = AGENTS.find((a) => a.name === activeAgentId);
  if (!agent) return { name: activeAgentId, Icon: Bot };
  return { name: agent.displayName, Icon: agent.icon };
}

export function AgentChat() {
  const router = useRouter();
  const {
    activeAgentId,
    setActiveAgentId,
    messages,
    isLoading,
    sendMessage,
    cancelMessage,
    clearMessages,
    pendingQueue,
    removeFromQueue,
  } = useConversations();

  const { name: agentName, Icon: AgentIcon } = useActiveAgentLabel(activeAgentId);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AgentSidebar activeAgentId={activeAgentId} onSelectAgent={setActiveAgentId} />

      <main className="flex-1 flex flex-col bg-background relative min-w-0">
        {/* Glass header */}
        <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex justify-between items-center w-full px-8 py-4 shrink-0">
          <div className="flex items-center gap-4">
            <AgentIcon className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground tracking-tight">{agentName}</h1>
            <span className="px-2.5 py-0.5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground tracking-wider uppercase">
              Active Session
            </span>
          </div>
          <div className="flex items-center gap-2">
            {messages.length > 0 && (
              <button
                onClick={clearMessages}
                className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                title="Clear chat"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
              <Bell className="w-4 h-4" />
            </button>
            <button
              onClick={() => router.push("/settings")}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-primary/10">
              <img src={USER_AVATAR} alt="User" className="w-full h-full object-cover" />
            </div>
          </div>
        </header>

        {/* Chat area */}
        <Conversation className="flex-1 bg-background">
          <ConversationContent>
            {messages.length === 0 ? (
              <ConversationEmptyState className="justify-start pt-8">
                <IntroCard key={activeAgentId} onSelect={sendMessage} agentId={activeAgentId} />
              </ConversationEmptyState>
            ) : (
              messages.map((msg) => <ChatMessageItem key={msg.id} msg={msg} />)
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <footer className="px-6 pb-6 pt-0 w-full max-w-5xl mx-auto shrink-0">
          <ChatInputBar
            onSubmit={sendMessage}
            onCancel={cancelMessage}
            isLoading={isLoading}
            pendingQueue={pendingQueue}
            onRemoveFromQueue={removeFromQueue}
          />
          <p className="text-center mt-3 text-[10px] text-muted-foreground/40 font-medium tracking-widest uppercase">
            Secured by Dove's whiskers
          </p>
        </footer>

        {/* Background gradient overlays */}
        <div className="fixed top-0 right-0 w-1/3 h-full bg-linear-to-l from-primary/5 to-transparent pointer-events-none z-0" />
        <div className="fixed bottom-0 left-0 w-1/2 h-1/2 bg-linear-to-tr from-accent/10 to-transparent pointer-events-none z-0" />
      </main>
    </div>
  );
}
