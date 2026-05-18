"use client";

import * as React from "react";
import { Clock, Loader2, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AgentSession } from "@/components/hooks/use-agent-sessions";
import { formatRelativeTime } from "@/lib/utils";
import { useButtonShimmer } from "@/components/hooks/use-button-shimmer";
import { useAsyncAction } from "@/components/hooks/use-async-action";

interface SessionHistoryItemProps {
  session: AgentSession;
  isActive: boolean;
  isRunning: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
}

function SessionHistoryItem({
  session,
  isActive,
  isRunning,
  onSelect,
  onDelete,
}: SessionHistoryItemProps) {
  const shimmerRef = useButtonShimmer(isRunning);
  // Keep the selected theme while running so switching sessions doesn't drop to unselected style.
  const isSelected = isActive || isRunning;
  const { pending: isDeleting, trigger: runDelete } = useAsyncAction(() => onDelete(session.id));

  return (
    <div
      className={`group relative overflow-hidden flex items-center gap-2 px-3 py-2 transition-colors ${
        isSelected ? "bg-primary/8" : "hover:bg-muted/50"
      }`}
    >
      {isRunning && (
        <span
          ref={shimmerRef}
          aria-hidden
          className="absolute inset-y-0 left-0 w-1/2 pointer-events-none -skew-x-12"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0.06) 75%, transparent 100%)",
          }}
        />
      )}
      <div
        className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
          isRunning ? "bg-primary animate-pulse" : isSelected ? "bg-primary" : "bg-border"
        }`}
      />
      <button
        onClick={() => onSelect(session.id)}
        className={`flex-1 flex items-baseline gap-2 text-left min-w-0 ${
          isSelected ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <span className="text-xs truncate">{session.label}</span>
        <span className="text-[10px] opacity-50 shrink-0">
          {formatRelativeTime(session.startedAt)}
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          void runDelete();
        }}
        disabled={isDeleting}
        className={`${
          isDeleting ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        } text-muted-foreground hover:text-destructive transition-all p-0.5 shrink-0 disabled:cursor-not-allowed disabled:hover:text-muted-foreground`}
        title={isDeleting ? "Deleting…" : "Delete"}
        aria-label={isDeleting ? "Deleting session" : "Delete session"}
      >
        {isDeleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
      </button>
    </div>
  );
}

interface SessionHistoryPanelProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  runningSessionIds?: Set<string>;
  onSelect: (contextId: string) => void;
  onNew: () => void;
  onDelete: (contextId: string) => void | Promise<void>;
}

export function SessionHistoryPanel({
  sessions,
  activeSessionId,
  runningSessionIds,
  onSelect,
  onNew,
  onDelete,
}: SessionHistoryPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20 bg-muted/10 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onNew}
          className="rounded-full text-primary hover:bg-primary/10"
          title="New session"
        >
          <PlusCircle size={16} />
          New session
        </Button>
        <span className="flex-1" />
        <Clock className="w-4 h-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Session History</span>
      </div>

      {/* Session list */}
      <div className="flex-1 flex flex-col overflow-y-auto overscroll-contain min-h-0">
        {sessions.length === 0 ? (
          <p className="text-xs text-muted-foreground/50 text-center py-6 select-none">
            No sessions yet
          </p>
        ) : (
          sessions.map((s) => (
            <SessionHistoryItem
              key={s.id}
              session={s}
              isActive={s.id === activeSessionId}
              isRunning={runningSessionIds?.has(s.id) ?? false}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
