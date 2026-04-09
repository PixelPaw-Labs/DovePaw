"use client";

import * as React from "react";
import { Clock, PlusCircle, Trash2 } from "lucide-react";
import type { AgentSession } from "@/components/hooks/use-agent-sessions";
import { formatRelativeTime } from "@/lib/utils";

interface SessionHistoryPanelProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelect: (contextId: string) => void;
  onNew: () => void;
  onDelete: (contextId: string) => void;
}

export function SessionHistoryPanel({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
}: SessionHistoryPanelProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20 bg-muted/10 shrink-0">
        <button
          onClick={onNew}
          className="flex items-center gap-2 text-sm font-semibold text-primary bg-primary/10 hover:bg-primary/20 transition-colors px-4 py-1.5 rounded-full"
          title="New session"
        >
          <PlusCircle size={16} />
          New session
        </button>
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
          sessions.map((s) => {
            const isActive = s.id === activeSessionId;
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-2 px-3 py-2 transition-colors ${
                  isActive ? "bg-primary/8" : "hover:bg-muted/50"
                }`}
              >
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                    isActive ? "bg-primary" : "bg-border"
                  }`}
                />
                <button
                  onClick={() => onSelect(s.id)}
                  className={`flex-1 flex items-baseline gap-2 text-left min-w-0 ${
                    isActive
                      ? "text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span className="text-xs truncate">{s.label}</span>
                  <span className="text-[10px] opacity-50 shrink-0">
                    {formatRelativeTime(s.startedAt)}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 shrink-0"
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
