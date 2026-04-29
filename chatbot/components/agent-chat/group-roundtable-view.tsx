"use client";

import * as React from "react";
import { useMemo } from "react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { ChatMessage } from "@/components/hooks/use-messages";
import { messageText } from "@/components/hooks/use-messages";

export const USER_BUCKET = "__user__";

export function bucketOf(msg: ChatMessage): string {
  if (msg.role === "assistant") return msg.agentId ?? USER_BUCKET;
  if (msg.senderAgentId) return msg.senderAgentId;
  return USER_BUCKET;
}

export interface ArcEvent {
  from: string;
  to: string;
  msgId: string;
}

export function arcFor(messages: ChatMessage[], idx: number): ArcEvent | null {
  const msg = messages[idx];
  if (!msg) return null;
  if (msg.role === "user" && !msg.senderAgentId) {
    if (msg.agentId && msg.agentId.toLowerCase() !== "dove")
      return { from: USER_BUCKET, to: msg.agentId, msgId: msg.id };
    return null;
  }
  if (msg.role === "user" && msg.senderAgentId) return null;
  const target = bucketOf(msg);
  if (target.toLowerCase() === "dove") return null;
  for (let i = idx - 1; i >= 0; i--) {
    const prev = bucketOf(messages[i]);
    if (prev.toLowerCase() === "dove") continue;
    if (prev !== target) return { from: prev, to: target, msgId: msg.id };
  }
  return null;
}

interface GroupRoundtableViewProps {
  messages: ChatMessage[];
  memberAgentIds: string[];
  agentConfigs: AgentConfigEntry[];
}

interface Cell {
  col: number;
  row: number;
  x: number;
  y: number;
}

export function GroupRoundtableView({
  messages,
  memberAgentIds,
  agentConfigs,
}: GroupRoundtableViewProps) {
  const members = useMemo(
    () => memberAgentIds.filter((id) => id.toLowerCase() !== "dove"),
    [memberAgentIds],
  );

  const { cols, rows } = useMemo(() => {
    const n = Math.max(1, members.length);
    const c = Math.ceil(Math.sqrt(n));
    const r = Math.ceil(n / c);
    return { cols: c, rows: r };
  }, [members.length]);

  const cells = useMemo<Cell[]>(() => {
    return members.map((_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return {
        col,
        row,
        x: ((col + 0.5) / cols) * 100,
        y: ((row + 0.5) / rows) * 100,
      };
    });
  }, [members, cols, rows]);

  const cellByMember = useMemo(() => {
    const map = new Map<string, Cell>();
    members.forEach((id, i) => map.set(id, cells[i]));
    return map;
  }, [members, cells]);

  // A handoff is active while the latest member message is streaming. The
  // visitor is the previous non-Dove member; the host is the current speaker.
  const handoff = useMemo(() => {
    if (messages.length === 0) return null;
    const latest = messages[messages.length - 1];
    if (!latest.isLoading) return null;
    const host = bucketOf(latest);
    if (host.toLowerCase() === "dove") return null;
    if (!cellByMember.has(host)) return null;
    for (let i = messages.length - 2; i >= 0; i--) {
      const prev = bucketOf(messages[i]);
      if (prev.toLowerCase() === "dove") continue;
      if (prev === host) continue;
      if (cellByMember.has(prev)) return { visitor: prev, host };
      return null;
    }
    return null;
  }, [messages, cellByMember]);

  const configByName = useMemo(() => new Map(agentConfigs.map((a) => [a.name, a])), [agentConfigs]);

  const latestByMember = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) {
      const b = bucketOf(m);
      if (cellByMember.has(b)) map.set(b, m);
    }
    return map;
  }, [messages, cellByMember]);

  // Visitor parks at the host cell's edge, offset toward the visitor's home
  // direction. The cell radius (in viewBox %) shrinks as the grid grows.
  const cellRadiusPct = (50 / Math.max(cols, rows)) * 0.55;

  function visitingPosition(visitorCell: Cell, hostCell: Cell) {
    const dx = visitorCell.x - hostCell.x;
    const dy = visitorCell.y - hostCell.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: hostCell.x + (dx / dist) * cellRadiusPct,
      y: hostCell.y + (dy / dist) * cellRadiusPct,
    };
  }

  function positionFor(memberId: string, cell: Cell) {
    if (!handoff || handoff.visitor !== memberId) return { x: cell.x, y: cell.y };
    const hostCell = cellByMember.get(handoff.host);
    if (!hostCell) return { x: cell.x, y: cell.y };
    return visitingPosition(cell, hostCell);
  }

  return (
    <div className="relative aspect-square w-full">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none z-0"
        aria-hidden="true"
      >
        {handoff &&
          (() => {
            const visitorCell = cellByMember.get(handoff.visitor);
            const hostCell = cellByMember.get(handoff.host);
            if (!visitorCell || !hostCell) return null;
            const end = visitingPosition(visitorCell, hostCell);
            return (
              <line
                x1={visitorCell.x}
                y1={visitorCell.y}
                x2={end.x}
                y2={end.y}
                stroke="currentColor"
                strokeWidth="0.18"
                strokeDasharray="0.8 0.6"
                strokeLinecap="round"
                className="text-muted-foreground"
                opacity="0.5"
              />
            );
          })()}
      </svg>
      {members.map((memberId, i) => {
        const cell = cells[i];
        const config = configByName.get(memberId);
        if (!config) return null;
        const def = buildAgentDef(config);
        const Icon = def.icon;
        const pos = positionFor(memberId, cell);
        const isHost = handoff?.host === memberId;
        const isVisitor = handoff?.visitor === memberId;
        return (
          <div
            key={memberId}
            data-bucket={memberId}
            data-active={isHost ? "true" : "false"}
            className={`absolute w-12 h-12 transition-[left,top] duration-500 ease-out ${isHost ? "z-20" : isVisitor ? "z-30" : "z-10"}`}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className={`relative w-12 h-12 rounded-2xl shadow-sm flex items-center justify-center overflow-hidden bg-background ${
                isHost
                  ? "ring-2 ring-primary shadow-[0_0_24px_rgb(73_97_115_/_0.6)] animate-[roundtable-halo_3s_ease-in-out_infinite]"
                  : ""
              }`}
            >
              <span aria-hidden="true" className={`absolute inset-0 ${def.iconBg ?? "bg-muted"}`} />
              {Icon ? <Icon className={`relative w-6 h-6 ${def.iconColor ?? ""}`} /> : null}
            </div>
            <div className="absolute top-full left-3/4 -translate-x-1/2 mt-1.5 text-[11px] font-semibold text-foreground whitespace-nowrap leading-none">
              {def.displayName ?? memberId}
            </div>
            <div className={`absolute bottom-full left-3/4 mb-2 ${isHost ? "w-56" : "w-36"}`}>
              <ClosedBubble msg={latestByMember.get(memberId)} isActive={isHost} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClosedBubble({ msg, isActive = false }: { msg?: ChatMessage; isActive?: boolean }) {
  const text = msg ? messageText(msg).trim() : "";
  const placeholder = msg?.isLoading ? "…" : "";
  return (
    <div className="relative">
      <div
        className={`rounded-2xl rounded-bl-none bg-muted border border-border/40 leading-snug text-foreground/90 text-left overflow-y-auto ${
          isActive
            ? "px-4 py-2.5 text-xs min-h-16 max-h-48"
            : "px-3 py-1.5 text-[10px] min-h-10 max-h-20"
        } ${!text && !placeholder ? "opacity-40 italic" : ""}`}
      >
        {text || placeholder || "—"}
      </div>
      <div className="absolute bottom-0 left-0 -translate-x-1/2 translate-y-1/2 rotate-45 w-4 h-4 bg-muted border-b border-l border-border/40" />
    </div>
  );
}
