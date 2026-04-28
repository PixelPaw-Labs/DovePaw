"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "animejs";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { USER_AVATAR } from "@/lib/avatars";
import type { ChatMessage } from "@/components/hooks/use-messages";
import { messageText } from "@/components/hooks/use-messages";
import { ChatMessageItem } from "./chat-message";

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
    if (msg.agentId) return { from: USER_BUCKET, to: msg.agentId, msgId: msg.id };
    return null;
  }
  if (msg.role === "user" && msg.senderAgentId) return null;
  const target = bucketOf(msg);
  for (let i = idx - 1; i >= 0; i--) {
    const prev = bucketOf(messages[i]);
    if (prev !== target) return { from: prev, to: target, msgId: msg.id };
  }
  return null;
}

interface GroupRoundtableViewProps {
  messages: ChatMessage[];
  memberAgentIds: string[];
  agentConfigs: AgentConfigEntry[];
}

interface SlotPosition {
  bucket: string;
  cxPct: number;
  cyPct: number;
}

const RING_RADIUS_PCT = 36;

function computePositions(buckets: string[]): SlotPosition[] {
  const n = buckets.length;
  if (n === 0) return [];
  if (n === 1) return [{ bucket: buckets[0], cxPct: 50, cyPct: 50 }];
  return buckets.map((bucket, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return {
      bucket,
      cxPct: 50 + RING_RADIUS_PCT * Math.cos(angle),
      cyPct: 50 + RING_RADIUS_PCT * Math.sin(angle),
    };
  });
}

export function GroupRoundtableView({
  messages,
  memberAgentIds,
  agentConfigs,
}: GroupRoundtableViewProps) {
  const buckets = useMemo(() => [USER_BUCKET, ...memberAgentIds], [memberAgentIds]);
  const positions = useMemo(() => computePositions(buckets), [buckets]);
  const positionByBucket = useMemo(
    () => new Map(positions.map((p) => [p.bucket, p])),
    [positions],
  );

  const configByName = useMemo(
    () => new Map(agentConfigs.map((a) => [a.name, a])),
    [agentConfigs],
  );

  const messagesByBucket = useMemo(() => {
    const map = new Map<string, ChatMessage[]>();
    for (const m of messages) {
      const b = bucketOf(m);
      const list = map.get(b);
      if (list) list.push(m);
      else map.set(b, [m]);
    }
    return map;
  }, [messages]);

  const [expandedBucket, setExpandedBucket] = useState<string | null>(null);
  const toggleExpanded = (bucket: string) =>
    setExpandedBucket((prev) => (prev === bucket ? null : bucket));

  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastAnimatedMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || messages.length === 0) return;
    const lastIdx = messages.length - 1;
    const lastMsg = messages[lastIdx];
    if (lastMsg.id === lastAnimatedMsgIdRef.current) return;
    lastAnimatedMsgIdRef.current = lastMsg.id;
    const arc = arcFor(messages, lastIdx);
    if (!arc) return;
    const fromPos = positionByBucket.get(arc.from);
    const toPos = positionByBucket.get(arc.to);
    if (!fromPos || !toPos) return;

    const path = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    const mx = (fromPos.cxPct + toPos.cxPct) / 2;
    const my = (fromPos.cyPct + toPos.cyPct) / 2;
    const dx = toPos.cxPct - fromPos.cxPct;
    const dy = toPos.cyPct - fromPos.cyPct;
    const cx = mx - dy * 0.25;
    const cy = my + dx * 0.25;
    path.setAttribute("d", `M ${fromPos.cxPct} ${fromPos.cyPct} Q ${cx} ${cy} ${toPos.cxPct} ${toPos.cyPct}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "0.4");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("class", "text-primary");
    svg.appendChild(path);

    const length = path.getTotalLength?.() ?? 100;
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);
    path.style.opacity = "0.9";

    animate(path, {
      strokeDashoffset: [length, 0],
      duration: 700,
      easing: "easeOutCubic",
      complete: () => {
        animate(path, {
          opacity: [0.9, 0],
          duration: 800,
          easing: "linear",
          complete: () => path.parentNode?.removeChild(path),
        });
      },
    });
  }, [messages, positionByBucket]);

  return (
    <div className="relative w-full max-w-[640px] mx-auto aspect-square">
      <svg
        ref={svgRef}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
        aria-hidden="true"
      />
      {positions.map((pos) => {
        const bucketMessages = messagesByBucket.get(pos.bucket) ?? [];
        const latest = bucketMessages[bucketMessages.length - 1];
        const isUser = pos.bucket === USER_BUCKET;
        const config = isUser ? null : configByName.get(pos.bucket);
        const isActive = !!latest?.isLoading;
        const isExpanded = expandedBucket === pos.bucket;
        const displayName = isUser ? "You" : (config?.displayName ?? pos.bucket);
        const def = config ? buildAgentDef(config) : null;
        const Icon = def?.icon;
        return (
          <div
            key={pos.bucket}
            data-bucket={pos.bucket}
            data-active={isActive ? "true" : "false"}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2 w-44"
            style={{ left: `${pos.cxPct}%`, top: `${pos.cyPct}%` }}
          >
            <button
              type="button"
              onClick={() => toggleExpanded(pos.bucket)}
              aria-label={`Toggle ${displayName} messages`}
              className={`relative w-12 h-12 rounded-2xl shadow-sm flex items-center justify-center transition-transform hover:scale-105 ${
                isUser ? "bg-secondary border-2 border-secondary overflow-hidden" : (def?.iconBg ?? "bg-muted")
              } ${isActive ? "ring-2 ring-primary animate-pulse" : ""}`}
            >
              {isUser ? (
                <img src={USER_AVATAR} alt="You" className="w-full h-full object-cover" />
              ) : Icon ? (
                <Icon className={`w-6 h-6 ${def?.iconColor ?? ""}`} />
              ) : null}
            </button>
            <div className="text-[11px] font-semibold text-foreground leading-none">
              {displayName}
            </div>
            <div className="w-full">
              {isExpanded ? (
                <ExpandedStack messages={bucketMessages} agentConfigs={agentConfigs} />
              ) : latest ? (
                <ClosedBubble msg={latest} />
              ) : (
                <div className="text-[10px] text-muted-foreground/60 text-center italic">idle</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ClosedBubble({ msg }: { msg: ChatMessage }) {
  const text = messageText(msg).trim();
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return (
    <div className="rounded-xl bg-muted/70 border border-border/40 px-3 py-1.5 text-[11px] leading-snug text-foreground/90 line-clamp-3 text-center">
      {preview || (msg.isLoading ? "…" : "")}
    </div>
  );
}

function ExpandedStack({
  messages,
  agentConfigs,
}: {
  messages: ChatMessage[];
  agentConfigs: AgentConfigEntry[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  return (
    <div
      ref={ref}
      className="rounded-xl bg-background/95 border border-primary/30 shadow-md p-2 max-h-64 overflow-y-auto flex flex-col gap-2"
    >
      {messages.map((m) => (
        <ChatMessageItem
          key={m.id}
          msg={m}
          agentConfigs={agentConfigs}
          hideReasoning
          hideAvatars
        />
      ))}
    </div>
  );
}
