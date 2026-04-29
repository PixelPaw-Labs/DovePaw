"use client";

import * as React from "react";
import { useMemo, useRef, useState, useLayoutEffect, useEffect } from "react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { ChatMessage } from "@/components/hooks/use-messages";
import { messageText } from "@/components/hooks/use-messages";

export const USER_BUCKET = "__user__";

export type RouteStyle = "straight" | "arc-cw" | "arc-ccw" | "wave";
const ROUTE_STYLES: RouteStyle[] = ["straight", "arc-cw", "arc-ccw", "wave"];

export function buildHandoffPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: RouteStyle,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;

  if (style === "straight") return `M ${x1} ${y1} L ${x2} ${y2}`;

  if (style === "arc-cw" || style === "arc-ccw") {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const amp = len * 0.35;
    const [px, py] = style === "arc-cw" ? [dy / len, -dx / len] : [-dy / len, dx / len];
    return `M ${x1} ${y1} Q ${mx + px * amp} ${my + py * amp} ${x2} ${y2}`;
  }

  // wave — S-curve cubic bezier
  const amp = len * 0.25;
  const px = -dy / len;
  const py = dx / len;
  const cx1 = x1 + dx * 0.33 + px * amp;
  const cy1 = y1 + dy * 0.33 + py * amp;
  const cx2 = x1 + dx * 0.67 - px * amp;
  const cy2 = y1 + dy * 0.67 - py * amp;
  return `M ${x1} ${y1} C ${cx1} ${cy1} ${cx2} ${cy2} ${x2} ${y2}`;
}

export function samplePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  style: RouteStyle,
  n = 9,
): Array<{ x: number; y: number }> {
  if (style === "straight")
    return [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ];
  const dx = x2 - x1,
    dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  if (style === "arc-cw" || style === "arc-ccw") {
    const mx = (x1 + x2) / 2,
      my = (y1 + y2) / 2;
    const amp = len * 0.35;
    const [px, py] = style === "arc-cw" ? [dy / len, -dx / len] : [-dy / len, dx / len];
    const cx = mx + px * amp,
      cy = my + py * amp;
    return Array.from({ length: n }, (_, i) => {
      const t = i / (n - 1),
        mt = 1 - t;
      return {
        x: mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
        y: mt * mt * y1 + 2 * mt * t * cy + t * t * y2,
      };
    });
  }
  const amp = len * 0.25,
    px = -dy / len,
    py = dx / len;
  const c1x = x1 + dx * 0.33 + px * amp,
    c1y = y1 + dy * 0.33 + py * amp;
  const c2x = x1 + dx * 0.67 - px * amp,
    c2y = y1 + dy * 0.67 - py * amp;
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1),
      mt = 1 - t;
    return {
      x: mt * mt * mt * x1 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x2,
      y: mt * mt * mt * y1 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y2,
    };
  });
}

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

type Rect = { left: number; top: number; right: number; bottom: number };
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
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

  const routeStyleRef = useRef<RouteStyle>("straight");
  const lastHandoffKey = useRef<string | null>(null);
  const handoffKey = handoff ? `${handoff.visitor}→${handoff.host}` : null;
  if (handoffKey !== lastHandoffKey.current) {
    lastHandoffKey.current = handoffKey;
    routeStyleRef.current = handoffKey
      ? ROUTE_STYLES[Math.floor(Math.random() * ROUTE_STYLES.length)]
      : "straight";
  }

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

  const lastFwdPtsRef = useRef<{ visitor: string; pts: Array<{ x: number; y: number }> } | null>(
    null,
  );

  const visitorAnimationStyle = useMemo(() => {
    if (!handoff) return null;
    const vc = cellByMember.get(handoff.visitor);
    const hc = cellByMember.get(handoff.host);
    if (!vc || !hc) return null;
    const dx = vc.x - hc.x,
      dy = vc.y - hc.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const end = { x: hc.x + (dx / dist) * cellRadiusPct, y: hc.y + (dy / dist) * cellRadiusPct };
    const pts = samplePath(vc.x, vc.y, end.x, end.y, routeStyleRef.current);
    lastFwdPtsRef.current = { visitor: handoff.visitor, pts };
    const name = `vm-${handoff.visitor}-${handoff.host}-${routeStyleRef.current}`;
    const stops = pts
      .map(
        (p, i) =>
          `${Math.round((i * 100) / (pts.length - 1))}% { left: ${p.x.toFixed(2)}%; top: ${p.y.toFixed(2)}%; }`,
      )
      .join(" ");
    return { name, keyframes: `@keyframes ${name} { ${stops} }` };
  }, [handoff, cellByMember, cellRadiusPct]);

  const [returnAnim, setReturnAnim] = useState<{
    name: string;
    keyframes: string;
    visitorId: string;
  } | null>(null);

  useLayoutEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!handoff) {
      const data = lastFwdPtsRef.current;
      if (data) {
        lastFwdPtsRef.current = null;
        const rev = data.pts.toReversed();
        const name = `vr-${data.visitor}-${Date.now()}`;
        const stops = rev
          .map(
            (p, i) =>
              `${Math.round((i * 100) / (rev.length - 1))}% { left: ${p.x.toFixed(2)}%; top: ${p.y.toFixed(2)}%; }`,
          )
          .join(" ");
        setReturnAnim({
          name,
          keyframes: `@keyframes ${name} { ${stops} }`,
          visitorId: data.visitor,
        });
        timer = setTimeout(() => setReturnAnim(null), 520);
      }
    } else {
      setReturnAnim(null);
    }
    return () => clearTimeout(timer);
  }, [handoff]);

  const containerRef = useRef<HTMLDivElement>(null);
  const bubbleWrapRefs = useRef(new Map<string, HTMLDivElement>());
  const nameLabelRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const container = containerRef.current;
    let obs: ResizeObserver | undefined;

    if (container) {
      const runCollision = () => {
        const W = container.offsetWidth;
        const H = container.offsetHeight;
        if (!W || !H) return;

        const iconRects = new Map<string, Rect>();
        const iconCenters = new Map<string, { icx: number; icy: number }>();
        const bubbleNaturalRects = new Map<string, Rect>();
        const nameLabelNaturalRects = new Map<string, Rect>();

        members.forEach((id) => {
          const cell = cellByMember.get(id);
          const bubbleEl = bubbleWrapRefs.current.get(id);
          if (!cell || !bubbleEl) return;

          let ix = cell.x,
            iy = cell.y;
          if (handoff?.visitor === id) {
            const hc = cellByMember.get(handoff.host);
            if (hc) {
              const vdx = cell.x - hc.x,
                vdy = cell.y - hc.y;
              const vd = Math.sqrt(vdx * vdx + vdy * vdy) || 1;
              ix = hc.x + (vdx / vd) * cellRadiusPct;
              iy = hc.y + (vdy / vd) * cellRadiusPct;
            }
          }
          const icx = (ix / 100) * W;
          const icy = (iy / 100) * H;
          const il = icx - 24,
            it = icy - 24;
          iconRects.set(id, { left: il, top: it, right: il + 48, bottom: it + 48 });
          iconCenters.set(id, { icx, icy });

          // Natural bubble position: absolute bottom-full left-3/4 mb-2
          // left-3/4 of 48px = 36px; bottom-full + mb-2 = icon top - 8px
          const bW = bubbleEl.offsetWidth;
          const bH = bubbleEl.offsetHeight;
          bubbleNaturalRects.set(id, {
            left: il + 36,
            top: it - 8 - bH,
            right: il + 36 + bW,
            bottom: it - 8,
          });

          // Name label: centered on icon, top-full mt-1.5 (6px below icon bottom)
          const nameEl = nameLabelRefs.current.get(id);
          if (nameEl) {
            const nW = nameEl.offsetWidth;
            const nH = nameEl.offsetHeight;
            const nL = icx - nW / 2;
            const nT = icy + 24 + 6; // icon bottom + mt-1.5
            nameLabelNaturalRects.set(id, { left: nL, top: nT, right: nL + nW, bottom: nT + nH });
          }
        });

        const bubbleEntries = Array.from(bubbleNaturalRects.entries());
        const iconEntries = Array.from(iconRects.entries());
        const nameEntries = Array.from(nameLabelNaturalRects.entries());

        members.forEach((id) => {
          const el = bubbleWrapRefs.current.get(id);
          const nat = bubbleNaturalRects.get(id);
          const ic = iconCenters.get(id);
          if (!el || !nat || !ic) return;

          const { icx, icy } = ic;
          const bW = nat.right - nat.left;
          const bH = nat.bottom - nat.top;
          const G = 8,
            R = 24; // gap and icon half-size

          // Candidate positions ordered by preference — all anchored near own icon
          const candidates = [
            { bL: icx + 12, bT: icy - R - G - bH }, // above-right (natural)
            { bL: icx - bW / 2, bT: icy - R - G - bH }, // above-center
            { bL: icx - 12 - bW, bT: icy - R - G - bH }, // above-left
            { bL: icx + R + G, bT: icy - bH / 2 }, // right
            { bL: icx - R - G - bW, bT: icy - bH / 2 }, // left
            { bL: icx + 12, bT: icy + R + G }, // below-right
            { bL: icx - bW / 2, bT: icy + R + G }, // below-center
            { bL: icx - 12 - bW, bT: icy + R + G }, // below-left
          ];

          const chosen =
            candidates.find((c) => {
              const r: Rect = { left: c.bL, top: c.bT, right: c.bL + bW, bottom: c.bT + bH };
              return (
                !bubbleEntries.some(([oid, o]) => oid !== id && rectsOverlap(r, o)) &&
                !iconEntries.some(([oid, o]) => oid !== id && rectsOverlap(r, o)) &&
                !nameEntries.some(([, o]) => rectsOverlap(r, o))
              );
            }) ?? candidates[0];

          const dx = Math.round(chosen.bL - nat.left);
          const dy = Math.round(chosen.bT - nat.top);
          el.style.transform = dx !== 0 || dy !== 0 ? `translate(${dx}px,${dy}px)` : "";
        });
      };

      runCollision();
      obs = new ResizeObserver(runCollision);
      bubbleWrapRefs.current.forEach((el) => obs!.observe(el));
    }

    // Re-run whenever any bubble changes size (e.g. streaming content growing)
    return () => obs?.disconnect();
    // cellByMember and cellRadiusPct are derived from members; include for correctness
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, cellByMember, cellRadiusPct, handoff?.visitor, handoff?.host]);

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
    <div ref={containerRef} className="relative aspect-square w-full">
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
              <path
                d={buildHandoffPath(
                  visitorCell.x,
                  visitorCell.y,
                  end.x,
                  end.y,
                  routeStyleRef.current,
                )}
                fill="none"
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
      {visitorAnimationStyle && <style>{visitorAnimationStyle.keyframes}</style>}
      {returnAnim && <style>{returnAnim.keyframes}</style>}
      {members.map((memberId, i) => {
        const cell = cells[i];
        const config = configByName.get(memberId);
        if (!config) return null;
        const def = buildAgentDef(config);
        const Icon = def.icon;
        const pos = positionFor(memberId, cell);
        const isHost = handoff?.host === memberId;
        const isVisitor = handoff?.visitor === memberId;
        const isReturning = returnAnim?.visitorId === memberId;
        return (
          <div
            key={memberId}
            data-bucket={memberId}
            data-active={isHost ? "true" : "false"}
            className={`absolute w-12 h-12 ${(isVisitor && visitorAnimationStyle) || isReturning ? "" : "transition-[left,top] duration-500 ease-out"} ${isHost ? "z-20" : isVisitor || isReturning ? "z-30" : "z-10"}`}
            style={{
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              transform: "translate(-50%, -50%)",
              ...(isVisitor && visitorAnimationStyle
                ? { animation: `${visitorAnimationStyle.name} 500ms ease-out forwards` }
                : isReturning && returnAnim
                  ? { animation: `${returnAnim.name} 500ms ease-out` }
                  : {}),
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
            <div
              ref={(el) => {
                if (el) nameLabelRefs.current.set(memberId, el);
                else nameLabelRefs.current.delete(memberId);
              }}
              className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 text-[11px] font-semibold text-foreground whitespace-nowrap leading-none"
            >
              {def.displayName ?? memberId}
            </div>
            <div
              ref={(el) => {
                if (el) bubbleWrapRefs.current.set(memberId, el);
                else bubbleWrapRefs.current.delete(memberId);
              }}
              className={`absolute bottom-full left-3/4 mb-2 ${isHost ? "w-56 min-h-24" : "w-36 min-h-16"}`}
              style={{ transition: "transform 400ms ease-out" }}
            >
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
        className={`rounded-2xl bg-muted border border-border/40 leading-snug text-foreground/90 text-left overflow-x-hidden overflow-y-auto ${
          isActive
            ? "px-4 py-2.5 text-xs min-h-24 max-h-48"
            : "px-3 py-1.5 text-[10px] min-h-16 max-h-40"
        } ${!text && !placeholder ? "opacity-40 italic" : ""}`}
      >
        {text || placeholder || "—"}
      </div>
    </div>
  );
}
