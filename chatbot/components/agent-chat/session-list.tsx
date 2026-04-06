"use client";

import * as React from "react";
import { PlusCircle, Trash2 } from "lucide-react";
import type { AgentSession } from "@/components/hooks/use-agent-sessions";
import { formatRelativeTime } from "@/lib/utils";

interface SessionListProps {
  sessions: AgentSession[];
  activeSessionId: string | null;
  onSelect: (contextId: string) => void;
  onNew: () => void;
  onDelete: (contextId: string) => void;
}

export function SessionList({
  sessions,
  activeSessionId,
  onSelect,
  onNew,
  onDelete,
}: SessionListProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/50 bg-muted/30 overflow-x-auto shrink-0">
      <button
        onClick={onNew}
        className="flex items-center gap-1 shrink-0 px-2 py-0.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <PlusCircle size={11} />
        New
      </button>
      <div className="w-px h-3 bg-border/60 shrink-0 mx-0.5" />
      {sessions.map((s) => {
        const isActive = s.id === activeSessionId;
        return (
          <div
            key={s.id}
            className={`group flex items-center gap-1 shrink-0 rounded transition-colors whitespace-nowrap ${
              isActive ? "bg-primary/10" : "hover:bg-muted"
            }`}
          >
            <button
              onClick={() => onSelect(s.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 text-xs max-w-[160px] ${
                isActive
                  ? "text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={s.label}
            >
              <span className="truncate">{s.label}</span>
              <span className="opacity-50 shrink-0">{formatRelativeTime(s.startedAt)}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
              className="opacity-0 group-hover:opacity-100 pr-1.5 text-muted-foreground hover:text-destructive transition-all"
              title="Delete session"
            >
              <Trash2 size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
