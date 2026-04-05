"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Bot, Clock, GitBranch, Settings, Trash2 } from "lucide-react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { USER_AVATAR } from "@/lib/avatars";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ChatInputBar } from "./agent-chat/chat-input-bar";
import { ProcessingBar } from "./agent-chat/processing-bar";
import { useConversations } from "@/components/hooks/use-conversations";
import { ConversationProvider } from "@/components/hooks/use-conversation-context";
import { AgentSidebar } from "./agent-chat/agent-sidebar";
import { ChatMessageItem } from "./agent-chat/chat-message";
import { IntroCard } from "./agent-chat/intro-card";
import { WorkflowPanel } from "./workflow/workflow-panel";
import { SessionHistoryPopup } from "./agent-chat/session-history-popup";
import { useAgentSessions } from "@/components/hooks/use-agent-sessions";
import { useDoveSessions } from "@/components/hooks/use-dove-sessions";

function useActiveAgentLabel(activeAgentId: string, agentConfigs: AgentConfigEntry[]) {
  if (activeAgentId === "dove") return { name: "Dove", Icon: Bot };
  const entry = agentConfigs.find((a) => a.name === activeAgentId);
  if (!entry) return { name: activeAgentId, Icon: Bot };
  const def = buildAgentDef(entry);
  return { name: def.displayName, Icon: def.icon };
}

interface AgentChatProps {
  agentConfigs: AgentConfigEntry[];
}

export function AgentChat({ agentConfigs }: AgentChatProps) {
  const router = useRouter();
  const {
    activeAgentId,
    setActiveAgentId,
    messages,
    sessionProgress,
    sessionCancelled,
    currentSessionId,
    setSessionId,
    isLoading,
    sendMessage,
    cancelMessage,
    newSession,
    deleteSession,
    pendingQueue,
    removeFromQueue,
  } = useConversations();

  const { sessions, refresh: refreshSessions } = useAgentSessions(activeAgentId);
  const {
    sessions: doveSessions,
    refresh: refreshDoveSessions,
    deleteDoveSession,
  } = useDoveSessions(activeAgentId === "dove");

  // Refresh session list after each completed response
  const prevIsLoadingRef = React.useRef(isLoading);
  React.useEffect(() => {
    if (prevIsLoadingRef.current && !isLoading) {
      if (activeAgentId === "dove") void refreshDoveSessions();
      else void refreshSessions(activeAgentId);
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, activeAgentId, refreshSessions, refreshDoveSessions]);

  const { name: agentName, Icon: AgentIcon } = useActiveAgentLabel(activeAgentId, agentConfigs);
  const [workflowOpen, setWorkflowOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);

  // Close history popup when switching agents
  React.useEffect(() => {
    setHistoryOpen(false);
  }, [activeAgentId]);
  const mainRef = React.useRef<HTMLElement>(null);
  const [panelWidth, setPanelWidth] = React.useState(380);
  const isResizing = React.useRef(false);
  const hasProgress = sessionProgress.length > 0;
  const lastAssistantHasContent = React.useMemo(() => {
    const last = messages.findLast((m) => m.role === "assistant");
    return (
      !!last && (last.segments.some((s) => s.type === "text" && s.content) || !!last.processContent)
    );
  }, [messages]);

  const onResizeStart = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isResizing.current = true;
      const startX = e.clientX;
      const startWidth = panelWidth;
      const onMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const delta = startX - ev.clientX;
        setPanelWidth(Math.max(260, startWidth + delta));
      };
      const onUp = () => {
        isResizing.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [panelWidth],
  );

  // Auto-open panel when progress first arrives
  const prevHasProgress = React.useRef(false);
  React.useEffect(() => {
    if (hasProgress && !prevHasProgress.current) setWorkflowOpen(true);
    prevHasProgress.current = hasProgress;
  }, [hasProgress]);

  return (
    <ConversationProvider isLoading={isLoading} activeAgentId={activeAgentId}>
      <div className="flex h-screen bg-background overflow-hidden">
        <AgentSidebar
          agentConfigs={agentConfigs}
          activeAgentId={activeAgentId}
          onSelectAgent={setActiveAgentId}
        />

        <main ref={mainRef} className="flex-1 flex flex-col bg-background relative min-w-0">
          {/* Glass header */}
          <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex justify-between items-center w-full px-6 py-2.5 shrink-0">
            <div className="flex items-center gap-3">
              <AgentIcon className="w-4 h-4 text-primary" />
              <h1 className="text-base font-bold text-foreground tracking-tight">{agentName}</h1>
              {isLoading ? (
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-primary/10 text-[10px] font-bold text-primary tracking-wider uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  Processing
                </span>
              ) : (
                <span className="px-2.5 py-0.5 rounded-full bg-accent text-[10px] font-bold text-accent-foreground tracking-wider uppercase">
                  Active Session
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${historyOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                title="Session history"
              >
                <Clock className="w-4 h-4" />
              </button>
              {messages.length > 0 && (
                <button
                  onClick={newSession}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                  title="Clear chat"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setWorkflowOpen((v) => !v)}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${workflowOpen ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                title="Workflow"
              >
                <GitBranch className="w-4 h-4" />
              </button>
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

          {/* Session history popup — draggable, floats within main */}
          <SessionHistoryPopup
            visible={historyOpen}
            sessions={activeAgentId === "dove" ? doveSessions : sessions}
            activeSessionId={currentSessionId}
            containerRef={mainRef}
            onSelect={setSessionId}
            onNew={() => {
              void newSession();
              setHistoryOpen(false);
            }}
            onDelete={
              activeAgentId === "dove"
                ? deleteDoveSession
                : async (contextId) => {
                    await deleteSession(contextId);
                    void refreshSessions(activeAgentId);
                  }
            }
            onClose={() => setHistoryOpen(false)}
          />

          {/* Chat area */}
          <Conversation className="flex-1 bg-background">
            <ConversationContent>
              {messages.length === 0 ? (
                <ConversationEmptyState className="justify-start pt-8">
                  <IntroCard
                    key={activeAgentId}
                    agentConfigs={agentConfigs}
                    onSelect={sendMessage}
                    agentId={activeAgentId}
                  />
                </ConversationEmptyState>
              ) : (
                messages.map((msg) => (
                  <ChatMessageItem key={msg.id} msg={msg} agentConfigs={agentConfigs} />
                ))
              )}
              {isLoading && lastAssistantHasContent && <ProcessingBar />}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <footer className="px-6 pb-4 pt-0 w-full max-w-5xl mx-auto shrink-0">
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

        {/* Workflow diagram panel */}
        {workflowOpen && (
          <aside
            style={{ width: panelWidth }}
            className="relative shrink-0 h-screen border-l border-border/20 bg-background/60 backdrop-blur-xl flex flex-col"
          >
            {/* Resize handle */}
            <div
              onMouseDown={onResizeStart}
              className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
            />
            <div className="px-4 py-3 border-b border-border/20 flex items-center gap-2 shrink-0">
              <GitBranch className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Workflow</span>
              <span className="ml-auto text-[10px] text-muted-foreground uppercase tracking-wider">
                Agent execution trace
              </span>
            </div>
            <div className="flex-1 min-h-0">
              <WorkflowPanel progress={sessionProgress} isCancelled={sessionCancelled} />
            </div>
          </aside>
        )}
      </div>
    </ConversationProvider>
  );
}
