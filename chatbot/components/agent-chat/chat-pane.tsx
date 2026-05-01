"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, Bot, ChevronLeft, ChevronRight, Clock, Info, Settings, Trash2 } from "lucide-react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { USER_AVATAR } from "@/lib/avatars";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { ChatInputBar } from "./chat-input-bar";
import { ProcessingBar } from "./processing-bar";
import { PermissionBanner } from "./permission-banner";
import { QuestionBanner } from "./question-banner";
import { ChatMessageItem } from "./chat-message";
import { IntroCard } from "./intro-card";
import type { ChatMessage } from "@/components/hooks/use-messages";
import type { ChatSsePermission, ChatSseQuestion } from "@/lib/chat-sse";

function useActiveAgentLabel(activeAgentId: string, agentConfigs: AgentConfigEntry[]) {
  if (activeAgentId === "dove") return { name: "Dove", Icon: Bot };
  const entry = agentConfigs.find((a) => a.name === activeAgentId);
  if (!entry) return { name: activeAgentId, Icon: Bot };
  const def = buildAgentDef(entry);
  return { name: def.displayName, Icon: def.icon };
}

export interface ChatPaneProps {
  agentId: string;
  agentConfigs: AgentConfigEntry[];
  // session state
  messages: ChatMessage[];
  isLoading: boolean;
  currentSessionId: string | null;
  pendingPermissions: ChatSsePermission[];
  pendingQuestions: ChatSseQuestion[];
  pendingQueue: string[];
  // session actions
  sendMessage: (content: string) => Promise<void>;
  cancelMessage: () => void;
  newSession: () => void;
  resolvePermission: (requestId: string, allowed: boolean) => Promise<void>;
  resolveQuestion: (requestId: string, answers: Record<string, string>) => Promise<void>;
  removeFromQueue: (index: number) => void;
  // history panel — caller constructs and owns this node
  historyPanel?: React.ReactNode;
}

export function ChatPane({
  agentId,
  agentConfigs,
  messages,
  isLoading,
  currentSessionId,
  pendingPermissions,
  pendingQuestions,
  pendingQueue,
  sendMessage,
  cancelMessage,
  newSession,
  resolvePermission,
  resolveQuestion,
  removeFromQueue,
  historyPanel,
}: ChatPaneProps) {
  const router = useRouter();
  const { name: agentName, Icon: AgentIcon } = useActiveAgentLabel(agentId, agentConfigs);

  const [historyOpen, setHistoryOpen] = React.useState(true);
  const [activeQuestionIdx, setActiveQuestionIdx] = React.useState(0);
  const [showAllAgents, setShowAllAgents] = React.useState(false);
  React.useEffect(() => {
    setShowAllAgents(false);
  }, [agentId, currentSessionId]);

  // Keep active index in bounds when questions are resolved
  const clampedQuestionIdx = Math.min(activeQuestionIdx, Math.max(0, pendingQuestions.length - 1));

  const [panelWidth, setPanelWidth] = React.useState(480);
  const isResizing = React.useRef(false);

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

  return (
    <>
      <main className="flex-1 flex flex-col bg-background relative min-w-0">
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
            {messages.some((msg) =>
              msg.segments.some(
                (s) => (s.type === "text" && s.content.trim()) || s.type === "tool_call",
              ),
            ) && (
              <button
                onClick={newSession}
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
              onClick={() => router.push("/about")}
              className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
              title="About DovePaw"
            >
              <Info className="w-4 h-4" />
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
          <ConversationContent className={showAllAgents ? "max-w-none" : ""}>
            {messages.filter((msg) =>
              msg.segments.some(
                (s) => (s.type === "text" && s.content.trim()) || s.type === "tool_call",
              ),
            ).length === 0 ? (
              <ConversationEmptyState className="justify-start pt-8">
                {!isLoading && (
                  <IntroCard
                    key={agentId}
                    agentConfigs={agentConfigs}
                    onSelect={sendMessage}
                    agentId={agentId}
                    showAllAgents={showAllAgents}
                    onShowAllAgentsChange={setShowAllAgents}
                  />
                )}
              </ConversationEmptyState>
            ) : (
              messages.map((msg) => (
                <ChatMessageItem key={msg.id} msg={msg} agentConfigs={agentConfigs} />
              ))
            )}
            {isLoading && <ProcessingBar />}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <footer className="px-6 pb-4 pt-0 w-full max-w-5xl mx-auto shrink-0">
          {(pendingPermissions.length > 0 || pendingQuestions.length > 0) && (
            <div className="mb-3 space-y-2">
              {pendingPermissions.map((req) => (
                <PermissionBanner
                  key={req.requestId}
                  request={req}
                  onAllow={() => void resolvePermission(req.requestId, true)}
                  onDeny={() => void resolvePermission(req.requestId, false)}
                />
              ))}
              {pendingQuestions.length > 0 &&
                (() => {
                  const req = pendingQuestions[clampedQuestionIdx];
                  return (
                    <div className="space-y-1">
                      {pendingQuestions.length > 1 && (
                        <div className="flex items-center justify-between px-1">
                          <span className="text-xs font-medium text-foreground">
                            Question <span className="text-primary">{clampedQuestionIdx + 1}</span>
                            <span className="text-muted-foreground">
                              {" "}
                              / {pendingQuestions.length}
                            </span>
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setActiveQuestionIdx((i) => Math.max(0, i - 1))}
                              disabled={clampedQuestionIdx === 0}
                              className="flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-muted/60 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <ChevronLeft className="size-3.5" />
                              Prev
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setActiveQuestionIdx((i) =>
                                  Math.min(pendingQuestions.length - 1, i + 1),
                                )
                              }
                              disabled={clampedQuestionIdx === pendingQuestions.length - 1}
                              className="flex items-center gap-1 px-2 py-1 rounded-md border border-border/60 bg-muted/60 text-xs font-medium text-foreground hover:bg-muted hover:border-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              Next
                              <ChevronRight className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                      <QuestionBanner
                        key={req.requestId}
                        request={req}
                        onSubmit={(answers) => {
                          void resolveQuestion(req.requestId, answers);
                        }}
                      />
                    </div>
                  );
                })()}
            </div>
          )}
          <ChatInputBar
            onSubmit={sendMessage}
            onCancel={cancelMessage}
            isLoading={isLoading}
            pendingQueue={pendingQueue}
            onRemoveFromQueue={removeFromQueue}
          />
          <p className="text-center mt-3 text-[10px] text-muted-foreground/40 font-medium tracking-widest uppercase">
            Secured by Dove&apos;s whiskers
          </p>
        </footer>

        {/* Background gradient overlays */}
        <div className="fixed top-0 right-0 w-1/3 h-full bg-linear-to-l from-primary/5 to-transparent pointer-events-none z-0" />
        <div className="fixed bottom-0 left-0 w-1/2 h-1/2 bg-linear-to-tr from-accent/10 to-transparent pointer-events-none z-0" />
      </main>

      {/* Right sidebar — session history */}
      {historyOpen && historyPanel && (
        <aside
          style={{ width: panelWidth }}
          className="relative shrink-0 h-screen border-l border-border/20 bg-background/60 backdrop-blur-xl flex flex-col overflow-hidden"
        >
          {/* Horizontal resize handle (left edge) */}
          <div
            onMouseDown={onResizeStart}
            className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-primary/30 transition-colors z-10"
          />
          {historyPanel}
        </aside>
      )}
    </>
  );
}
