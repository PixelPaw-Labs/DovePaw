"use client";

import * as React from "react";
import { Clock, PlusCircle, Trash2, X } from "lucide-react";
import { usePopupAnimation } from "./use-popup-animation";
import type { AgentSession } from "@/components/hooks/use-agent-sessions";
import { formatRelativeTime } from "@/lib/utils";

interface SessionHistoryPopupProps {
  visible: boolean;
  sessions: AgentSession[];
  activeSessionId: string | null;
  containerRef: React.RefObject<HTMLElement | null>;
  onSelect: (contextId: string) => void;
  onNew: () => void;
  onDelete: (contextId: string) => void;
  onClose: () => void;
}


export function SessionHistoryPopup({
  visible,
  sessions,
  activeSessionId,
  containerRef,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: SessionHistoryPopupProps) {
  const dragWrapperRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  usePopupAnimation({ visible, sessionCount: sessions.length, dragWrapperRef, panelRef, listRef, containerRef });

  return (
    // Drag wrapper — absolutely positioned, never scaled/faded itself
    <div
      ref={dragWrapperRef}
      style={{ position: "absolute", top: 68, right: 24, zIndex: 40, width: 284 }}
    >
      {/* Animated panel */}
      <div
        ref={panelRef}
        style={{ opacity: 0, pointerEvents: visible ? "auto" : "none" }}
        className="rounded-xl border border-border/40 bg-background/95 backdrop-blur-xl shadow-lg shadow-black/10 flex flex-col overflow-hidden"
      >
        {/* Header — also serves as the visual drag affordance */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/20 shrink-0 select-none">
          <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground flex-1">Session History</span>
          <button
            onClick={onNew}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-muted"
            title="New session"
          >
            <PlusCircle size={11} />
            New
          </button>
          <button
            onClick={onClose}
            className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted"
            title="Close"
          >
            <X size={12} />
          </button>
        </div>

        {/* Session list */}
        <div ref={listRef} className="flex flex-col max-h-72 overflow-y-auto overscroll-contain">
          {sessions.length === 0 ? (
            <p className="text-xs text-muted-foreground/50 text-center py-6 select-none">
              No sessions yet
            </p>
          ) : (
            sessions.map((s) => {
              const isActive = s.contextId === activeSessionId;
              return (
                <div
                  key={s.contextId}
                  className={`session-row group flex items-center gap-2 px-3 py-2 transition-colors ${
                    isActive ? "bg-primary/8" : "hover:bg-muted/50"
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${
                      isActive ? "bg-primary" : "bg-border"
                    }`}
                  />
                  <button
                    onClick={() => {
                      onSelect(s.contextId);
                      onClose();
                    }}
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
                      onDelete(s.contextId);
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
    </div>
  );
}
