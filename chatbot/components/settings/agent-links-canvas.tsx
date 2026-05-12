"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Panel,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  MarkerType,
  ConnectionMode,
  NodeResizer,
  applyNodeChanges,
  useInternalNode,
  useReactFlow,
  useStore,
  type InternalNode,
  type Node,
  type Edge,
  type NodeChange,
  type Connection,
  type NodeProps,
  type EdgeProps,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import Link from "next/link";
import { FolderPlus, Home, Info, LayoutGrid, List, Plus, Settings2, Users2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { AGENT_LINK_STRATEGIES } from "@@/lib/agent-links-schemas";
import type { AgentGroup, AgentLinksFile, AgentLinkStrategy } from "@@/lib/agent-links-schemas";
import {
  connectionPointsFromRect,
  findOptimalConnection,
  pointInRect,
  clampOutsideRects,
  nudgeControlPointClear,
  rectsOverlap,
  segmentPassesThroughRect,
  type ConnectionPoints,
  type Rect,
} from "@/lib/canvas-routing";
import { useAgentHeartbeat } from "@/components/hooks/use-agent-heartbeat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Constants ───────────────────────────────────────────────────────────────

const POSITIONS_KEY = "dovepaw:agent-links-canvas-positions";
const PLACED_KEY = "dovepaw:agent-links-canvas-placed";

const STRATEGY_COLORS: Record<AgentLinkStrategy, string> = {
  chat: "#4338ca",
  review: "#ea580c",
  escalation: "#be123c",
};

const STRATEGY_LABELS: Record<AgentLinkStrategy, string> = {
  chat: "Chat",
  review: "Review",
  escalation: "Escalate",
};

const STRATEGY_DESCRIPTIONS: Record<AgentLinkStrategy, string> = {
  chat: "Non-blocking",
  review: "Blocking approval",
  escalation: "Blocking guidance",
};

// ─── Types ───────────────────────────────────────────────────────────────────

type AgentNodeData = { config: AgentConfigEntry } & Record<string, unknown>;
type AgentEdgeData = {
  direction: "single" | "dual";
  strategy: AgentLinkStrategy;
} & Record<string, unknown>;
type GroupNodeData = { group: AgentGroup } & Record<string, unknown>;

type AgentFlowNode = Node<AgentNodeData, "agentNode">;
type GroupFlowNode = Node<GroupNodeData, "groupNode">;
type AnyFlowNode = AgentFlowNode | GroupFlowNode;
type AgentFlowEdge = Edge<AgentEdgeData, "agentEdge">;

// ─── Contexts ────────────────────────────────────────────────────────────────

const HeartbeatContext = createContext<Record<string, { online: boolean }>>({});
const DeleteEdgeContext = createContext<(edgeId: string, data: AgentEdgeData) => void>(() => {});
const RemoveNodeContext = createContext<(nodeId: string) => void>(() => {});
const EdgesContext = createContext<AgentFlowEdge[]>([]);
const EditGroupContext = createContext<(groupName: string) => void>(() => {});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function gridPosition(index: number, total: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  return { x: (index % cols) * 260, y: Math.floor(index / cols) * 200 };
}

type SavedNodeState = { x: number; y: number; w?: number; h?: number };

function loadPositions(): Record<string, SavedNodeState> {
  if (typeof window === "undefined") return {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "{}");
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, SavedNodeState>;
  } catch {
    return {};
  }
}

function savePositions(nodes: AnyFlowNode[]): void {
  const pos: Record<string, SavedNodeState> = {};
  for (const n of nodes) {
    const entry: SavedNodeState = { x: n.position.x, y: n.position.y };
    if (typeof n.style?.width === "number") entry.w = n.style.width;
    if (typeof n.style?.height === "number") entry.h = n.style.height;
    pos[n.id] = entry;
  }
  localStorage.setItem(POSITIONS_KEY, JSON.stringify(pos));
}

function loadPlacedAgents(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PLACED_KEY) ?? "[]");
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
    return new Set(Array.isArray(raw) ? (raw as string[]) : []);
  } catch {
    return new Set();
  }
}

function addPlacedAgent(name: string): void {
  const placed = loadPlacedAgents();
  placed.add(name);
  localStorage.setItem(PLACED_KEY, JSON.stringify([...placed]));
}

function removePlacedAgent(name: string): void {
  const placed = loadPlacedAgents();
  placed.delete(name);
  localStorage.setItem(PLACED_KEY, JSON.stringify([...placed]));
}

function buildEdgeId(source: string, target: string, strategy: AgentLinkStrategy): string {
  return `${source}||${target}||${strategy}`;
}

function putGroupMembers(groupName: string, members: string[]): Promise<Response> {
  return fetch("/api/settings/agent-links/groups/members", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: groupName, members }),
  });
}

function buildFlowEdge(
  source: string,
  target: string,
  direction: "single" | "dual",
  strategy: AgentLinkStrategy,
): AgentFlowEdge {
  return {
    id: buildEdgeId(source, target, strategy),
    source,
    target,
    type: "agentEdge",
    data: { direction, strategy },
    markerEnd: { type: MarkerType.ArrowClosed, color: STRATEGY_COLORS[strategy] },
    markerStart:
      direction === "dual"
        ? { type: MarkerType.ArrowClosed, color: STRATEGY_COLORS[strategy] }
        : undefined,
  };
}

// ─── Canvas constants ─────────────────────────────────────────────────────────

const NODE_W = 200;
const NODE_H = 110;
// Bow amount per step for parallel edges between the same node pair.
const CURVE_AMOUNT = 120;
// Minimum straight-line distance between chosen border points; if no border-pair
// meets this threshold the link is invisible (e.g. cards touching). Picks a
// longer border-pair so there's visible room for the bezier to curve.
const MIN_VISIBLE_LINK_LENGTH = 30;

// ─── Group helpers ───────────────────────────────────────────────────────────

const GROUP_COLS = 3;
const GROUP_PAD_X = 16;
const GROUP_PAD_TOP = 44; // space for the group label
const GROUP_PAD_BOTTOM = 12;

/**
 * Returns the maximum number of parallel edges between any single node-pair
 * whose both endpoints are members of the given group. Used to ensure the
 * group box is tall/wide enough for the bezier curves to route without
 * overlapping adjacent agent cards.
 */
function maxParallelEdgesInGroup(
  members: string[],
  links: { source: string; target: string }[],
): number {
  const memberSet = new Set(members);
  const pairCounts = new Map<string, number>();
  for (const link of links) {
    if (!memberSet.has(link.source) || !memberSet.has(link.target)) continue;
    const key = [link.source, link.target].toSorted().join("\0");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  return pairCounts.size > 0 ? Math.max(...pairCounts.values()) : 0;
}

/**
 * Minimum group box size to comfortably fit `memberCount` agent cards, with
 * enough inter-card spacing for up to `maxParallel` bezier curves between any
 * adjacent pair. Slot sizes scale with `maxParallel` so that even multiple
 * overlapping strategies have room to arc without clipping neighbouring cards.
 */
function groupNodeSize(memberCount: number, maxParallel = 0): { width: number; height: number } {
  const cols = Math.min(GROUP_COLS, Math.max(1, memberCount));
  const rows = Math.max(1, Math.ceil(memberCount / GROUP_COLS));
  // Only grow beyond the default slot size when there are 2+ parallel edges on
  // the same pair — that's when bezier curves start bowing wide enough to clip
  // adjacent cards. Single-edge groups keep the old compact slot dimensions.
  const curveGap = maxParallel > 1 ? (maxParallel - 1) * CURVE_AMOUNT : 0;
  const slotW = Math.max(280, NODE_W + GROUP_PAD_X * 2 + curveGap);
  const slotH = Math.max(200, NODE_H + GROUP_PAD_BOTTOM + curveGap);
  return {
    width: cols * slotW + GROUP_PAD_X * 2,
    height: rows * slotH + GROUP_PAD_TOP + GROUP_PAD_BOTTOM,
  };
}

function memberPositionInGroup(
  index: number,
  totalMembers: number,
  groupWidth: number,
  groupHeight: number,
): { x: number; y: number } {
  const cols = Math.min(GROUP_COLS, totalMembers);
  const rows = Math.ceil(totalMembers / GROUP_COLS);
  const slotW = (groupWidth - GROUP_PAD_X * 2) / cols;
  const slotH = (groupHeight - GROUP_PAD_TOP - GROUP_PAD_BOTTOM) / rows;
  return {
    x: (index % cols) * slotW + GROUP_PAD_X + (slotW - NODE_W) / 2,
    y: Math.floor(index / cols) * slotH + GROUP_PAD_TOP + (slotH - NODE_H) / 2,
  };
}

function isGroupNode(n: AnyFlowNode): n is GroupFlowNode {
  return n.type === "groupNode";
}

function isAgentNode(n: AnyFlowNode): n is AgentFlowNode {
  return n.type === "agentNode";
}

function styleNum(
  style: React.CSSProperties | undefined,
  key: "width" | "height",
): number | undefined {
  const v = style?.[key];
  return typeof v === "number" ? v : undefined;
}

// ─── Edge helpers (React Flow adapters) ─────────────────────────────────────
// Pure geometry lives in @/lib/canvas-routing; these two functions bridge
// React Flow's InternalNode to the framework-agnostic Rect / ConnectionPoints.

function nodeToRect(node: InternalNode): Rect {
  return {
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    w: node.measured?.width ?? 160,
    h: node.measured?.height ?? 110,
  };
}

function getConnectionPoints(node: InternalNode): ConnectionPoints {
  return connectionPointsFromRect(nodeToRect(node));
}

// ─── EditGroupMembersDialog ───────────────────────────────────────────────────

interface EditGroupMembersDialogProps {
  groupName: string | null;
  onOpenChange: (open: boolean) => void;
  allAgentConfigs: AgentConfigEntry[];
  currentMembers: string[];
  onSuccess: (groupName: string, newMembers: string[]) => void;
}

function EditGroupMembersDialog({
  groupName,
  onOpenChange,
  allAgentConfigs,
  currentMembers,
  onSuccess,
}: EditGroupMembersDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (groupName) {
      setSelected(new Set(currentMembers));
      setError("");
    }
  }, [groupName, currentMembers]);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupName) return;
    setError("");
    setSubmitting(true);
    try {
      const members = [...selected];
      const res = await putGroupMembers(groupName, members);
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to update members.");
        return;
      }
      onSuccess(groupName, members);
      onOpenChange(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={groupName !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Members — {groupName}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 pt-1"
        >
          <div className="space-y-0.5 max-h-64 overflow-y-auto">
            {allAgentConfigs.map((config) => {
              const def = buildAgentDef(config);
              const checked = selected.has(config.name);
              return (
                <label
                  key={config.name}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(config.name)}
                    className="rounded accent-primary"
                  />
                  <span className="text-sm text-foreground">{def.displayName}</span>
                </label>
              );
            })}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── GroupNode ───────────────────────────────────────────────────────────────

function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const onEditGroup = useContext(EditGroupContext);
  return (
    <>
      <NodeResizer
        minWidth={220}
        minHeight={160}
        isVisible={selected}
        lineClassName="!border-primary/40"
        handleClassName="!w-2.5 !h-2.5 !border-primary/40 !bg-background"
      />
      <div
        className={cn(
          "w-full h-full rounded-2xl border-2 border-border/60 bg-muted/15 backdrop-blur-sm",
          selected ? "border-primary/60" : "border-border/60",
        )}
      >
        <div
          className="px-3 pt-2 pb-1 flex items-center gap-2 cursor-pointer nodrag rounded-t-2xl hover:bg-primary/10 transition-colors group/header"
          onClick={() => onEditGroup(data.group.name)}
          title="Click to edit members"
        >
          <Users2 className="w-5 h-5 text-primary/70 shrink-0" />
          <span className="flex-1 text-base font-bold uppercase tracking-widest text-foreground/80 truncate">
            {data.group.name}
          </span>
          <Settings2 className="w-5 h-5 text-primary/60 shrink-0" />
        </div>
      </div>
    </>
  );
}

// ─── Node types (static — defined outside component to prevent re-creation) ─

const nodeTypes = { agentNode: AgentNode, groupNode: GroupNode };
const edgeTypes = { agentEdge: AgentEdge };

// ─── AgentNode ───────────────────────────────────────────────────────────────

function AgentNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const statuses = useContext(HeartbeatContext);
  const removeNode = useContext(RemoveNodeContext);
  const allEdges = useContext(EdgesContext);
  const def = buildAgentDef(data.config);
  const IconComponent = def.icon;
  const isOnline = statuses[data.config.name]?.online ?? false;
  const hasEdges = allEdges.some(
    (e) => e.source === data.config.name || e.target === data.config.name,
  );

  return (
    <div
      className={cn(
        "bg-card/90 backdrop-blur-sm border border-border/40 rounded-xl p-3 shadow-md",
        "group cursor-grab active:cursor-grabbing min-w-40 max-w-50",
        "hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200",
        selected && "ring-2 ring-primary/50 border-primary/30",
      )}
    >
      {/* Remove-from-canvas button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          removeNode(data.config.name);
        }}
        disabled={hasEdges}
        title={hasEdges ? "Remove links first" : "Remove from canvas"}
        className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-background border border-border/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm disabled:cursor-not-allowed disabled:opacity-30 hover:enabled:text-destructive hover:enabled:border-destructive/40 nodrag"
      >
        <X className="w-2.5 h-2.5" />
      </button>
      <Handle
        type="source"
        position={Position.Top}
        id="top"
        className="w-2! h-2! bg-primary/60! border-background! opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        className="w-2! h-2! bg-primary/60! border-background! opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="w-2! h-2! bg-primary/60! border-background! opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <Handle
        type="source"
        position={Position.Left}
        id="left"
        className="w-2! h-2! bg-primary/60! border-background! opacity-0 group-hover:opacity-100 transition-opacity"
      />

      <div className="flex items-center gap-2 mb-2">
        <div
          className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
            def.doveCard.iconBg,
            def.doveCard.iconColor,
          )}
        >
          <IconComponent className="w-4 h-4" />
        </div>
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full shrink-0",
            isOnline ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30",
          )}
        />
      </div>

      <p className="text-sm font-semibold text-foreground leading-tight">{def.displayName}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight line-clamp-2">
        {def.description}
      </p>
    </div>
  );
}

// ─── AgentEdge ───────────────────────────────────────────────────────────────

function AgentEdge({
  id,
  source,
  target,
  data,
  markerEnd,
  markerStart,
  style,
}: EdgeProps<AgentFlowEdge>) {
  const onDelete = useContext(DeleteEdgeContext);
  const allEdges = useContext(EdgesContext);
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);

  // Collect agent node rects to use as routing obstacles. Edges only collide with
  // agents in the same "scope":
  //   - intra-group edge (both endpoints in group G) → obstacles = other members of G
  //   - any edge with an ungrouped endpoint → obstacles = ungrouped agents only
  // Cross-scope cards are visually separated by the group box; including them
  // would re-route bezier paths every frame when a group is dragged past them.
  const obstacleRects = useStore((s) => {
    const srcParent = s.nodeLookup.get(source)?.parentId;
    const tgtParent = s.nodeLookup.get(target)?.parentId;
    const sameGroupId = srcParent != null && srcParent === tgtParent ? srcParent : null;
    const rects: Rect[] = [];
    s.nodeLookup.forEach((n, nodeId) => {
      if (nodeId === source || nodeId === target || n.type === "groupNode") return;
      if (sameGroupId != null ? n.parentId !== sameGroupId : n.parentId != null) return;
      rects.push({
        x: n.internals.positionAbsolute.x,
        y: n.internals.positionAbsolute.y,
        w: n.measured?.width ?? NODE_W,
        h: n.measured?.height ?? NODE_H,
      });
    });
    return rects;
  });

  if (!sourceNode || !targetNode) return null;

  // Labels always render above their link (which sits above agent cards via
  // defaultEdgeOptions zIndex 1000). 9999 also clears the group box for
  // intra-group edges.
  const labelZIndex = 9999;

  // All edges between the same node pair (both directions) share one sorted group.
  // Canonical lex order ensures bidirectional edges (A→B and B→A) use the same
  // perpendicular reference so their curves bow in opposite directions consistently.
  const canonSrc = source < target ? source : target;
  const canonTgt = source < target ? target : source;
  const parallelGroup = allEdges
    .filter(
      (e) =>
        (e.source === canonSrc && e.target === canonTgt) ||
        (e.source === canonTgt && e.target === canonSrc),
    )
    .toSorted((a, b) => a.id.localeCompare(b.id));
  const parallelIdx = parallelGroup.findIndex((e) => e.id === id);
  const curvature =
    parallelGroup.length > 1 ? (parallelIdx - (parallelGroup.length - 1) / 2) * CURVE_AMOUNT : 0;

  // Canonical perpendicular from canonSrc→canonTgt optimal border pair.
  const canonSrcNode = canonSrc === source ? sourceNode : targetNode;
  const canonTgtNode = canonSrc === source ? targetNode : sourceNode;
  const { from: canonFrom, to: canonTo } = findOptimalConnection(
    getConnectionPoints(canonSrcNode),
    getConnectionPoints(canonTgtNode),
    obstacleRects,
    MIN_VISIBLE_LINK_LENGTH,
  );
  const cdx = canonTo.x - canonFrom.x;
  const cdy = canonTo.y - canonFrom.y;
  const clen = Math.hypot(cdx, cdy) || 1;
  const perpX = -cdy / clen;
  const perpY = cdx / clen;

  // Quadratic bezier: both parallel edges share the same border-center endpoints;
  // the control point is pushed perpendicularly so each edge bows a different way.
  const { from: sp, to: tp } = findOptimalConnection(
    getConnectionPoints(sourceNode),
    getConnectionPoints(targetNode),
    obstacleRects,
    MIN_VISIBLE_LINK_LENGTH,
  );

  // If the chosen segment still crosses a card (fallback case), force a curve.
  const sRect = nodeToRect(sourceNode);
  const tRect = nodeToRect(targetNode);
  const straightCrossesCard =
    curvature === 0 &&
    (segmentPassesThroughRect(sp, tp, sRect, true, false) ||
      segmentPassesThroughRect(sp, tp, tRect, false, true) ||
      obstacleRects.some((obs) => segmentPassesThroughRect(sp, tp, obs, false, false)));
  let effectiveCurvature = straightCrossesCard ? CURVE_AMOUNT : curvature;

  let cpX = (sp.x + tp.x) / 2 + perpX * effectiveCurvature;
  let cpY = (sp.y + tp.y) / 2 + perpY * effectiveCurvature;

  // If the control point ends up inside either card, flip the bow direction.
  if (pointInRect({ x: cpX, y: cpY }, sRect) || pointInRect({ x: cpX, y: cpY }, tRect)) {
    effectiveCurvature = -effectiveCurvature;
    cpX = (sp.x + tp.x) / 2 + perpX * effectiveCurvature;
    cpY = (sp.y + tp.y) / 2 + perpY * effectiveCurvature;
  }

  // If the bezier arc still passes through an obstacle node, nudge the control
  // point away (increasing curvature, then flipping direction) until clear.
  ({
    cpX,
    cpY,
    curvature: effectiveCurvature,
  } = nudgeControlPointClear(
    sp,
    tp,
    perpX,
    perpY,
    effectiveCurvature,
    CURVE_AMOUNT,
    obstacleRects,
  ));

  const edgePath = `M ${sp.x} ${sp.y} Q ${cpX} ${cpY} ${tp.x} ${tp.y}`;
  // Midpoint of a quadratic bezier at t=0.5: 0.25·P0 + 0.5·P1 + 0.25·P2
  let labelX = 0.25 * sp.x + 0.5 * cpX + 0.25 * tp.x;
  let labelY = 0.25 * sp.y + 0.5 * cpY + 0.25 * tp.y;
  // If the label badge overlaps any agent card, push it perpendicular until clear.
  const LABEL_W = 80;
  const LABEL_H = 28;
  const allRects = [sRect, tRect, ...obstacleRects];
  for (let step = 1; step <= 4; step++) {
    const labRect: Rect = {
      x: labelX - LABEL_W / 2,
      y: labelY - LABEL_H / 2,
      w: LABEL_W,
      h: LABEL_H,
    };
    if (!allRects.some((r) => rectsOverlap(labRect, r))) break;
    labelX += perpX * 30;
    labelY += perpY * 30;
  }

  const strategy = data?.strategy ?? "chat";
  const color = STRATEGY_COLORS[strategy];

  return (
    <>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        markerStart={markerStart}
        style={{ stroke: color, strokeWidth: 1.5, strokeOpacity: 0.55, ...style }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            zIndex: labelZIndex,
            pointerEvents: "all",
          }}
          className="flex items-center gap-1 nodrag nopan"
        >
          <span
            style={{ color, borderColor: `${color}40`, backgroundColor: "var(--background)" }}
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border backdrop-blur-sm shadow-sm whitespace-nowrap"
          >
            {STRATEGY_LABELS[strategy]} {data?.direction === "dual" ? "↔" : "→"}
          </span>
          <button
            onClick={() => onDelete(id, data ?? { direction: "single", strategy: "chat" })}
            className="w-4 h-4 rounded-full bg-background/80 border border-border/40 flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors shadow-sm"
            title="Remove link"
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// ─── AgentLinksLegend ────────────────────────────────────────────────────────

function AgentLinksLegend() {
  return (
    <div className="bg-background/80 backdrop-blur-xl border border-border/20 rounded-xl shadow-lg p-4 min-w-52">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
        Legend
      </p>

      <p className="text-[9px] font-semibold uppercase tracking-widest text-primary/70 mb-2">
        Strategy
      </p>
      {(AGENT_LINK_STRATEGIES as readonly AgentLinkStrategy[]).map((s) => (
        <div key={s} className="flex items-center gap-2 mb-2">
          <svg width="32" height="12" className="shrink-0" aria-hidden>
            <defs>
              <marker
                id={`legend-${s}`}
                markerWidth="6"
                markerHeight="6"
                refX="5"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L6,3 Z" fill={STRATEGY_COLORS[s]} />
              </marker>
            </defs>
            <line
              x1="1"
              y1="6"
              x2="27"
              y2="6"
              stroke={STRATEGY_COLORS[s]}
              strokeWidth="2"
              markerEnd={`url(#legend-${s})`}
            />
          </svg>
          <span style={{ color: STRATEGY_COLORS[s] }} className="text-[10px] font-semibold">
            {STRATEGY_LABELS[s]}
          </span>
          <span className="text-[9px] text-muted-foreground">{STRATEGY_DESCRIPTIONS[s]}</span>
        </div>
      ))}

      <p className="text-[9px] font-semibold uppercase tracking-widest text-primary/70 mb-2 mt-3">
        Direction
      </p>
      <div className="flex items-center gap-2 mb-2">
        <svg width="32" height="12" className="shrink-0" aria-hidden>
          <defs>
            <marker
              id="legend-single"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L6,3 Z" fill="#6b7280" />
            </marker>
          </defs>
          <line
            x1="1"
            y1="6"
            x2="27"
            y2="6"
            stroke="#6b7280"
            strokeWidth="2"
            markerEnd="url(#legend-single)"
          />
        </svg>
        <span className="text-[10px] text-foreground">Single direction</span>
      </div>
      <div className="flex items-center gap-2">
        <svg width="32" height="12" className="shrink-0" aria-hidden>
          <defs>
            <marker
              id="legend-dual-end"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L6,3 Z" fill="#6b7280" />
            </marker>
            <marker
              id="legend-dual-start"
              markerWidth="6"
              markerHeight="6"
              refX="1"
              refY="3"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L0,6 L6,3 Z" fill="#6b7280" />
            </marker>
          </defs>
          <line
            x1="5"
            y1="6"
            x2="27"
            y2="6"
            stroke="#6b7280"
            strokeWidth="2"
            markerStart="url(#legend-dual-start)"
            markerEnd="url(#legend-dual-end)"
          />
        </svg>
        <span className="text-[10px] text-foreground">Bidirectional</span>
      </div>
    </div>
  );
}

// ─── SelectedAgentPanel ──────────────────────────────────────────────────────

interface SelectedAgentPanelProps {
  agentConfig: AgentConfigEntry;
  allEdges: AgentFlowEdge[];
  onClose: () => void;
  onAddLink: (source: string) => void;
}

function SelectedAgentPanel({
  agentConfig,
  allEdges,
  onClose,
  onAddLink,
}: SelectedAgentPanelProps) {
  const def = buildAgentDef(agentConfig);
  const IconComponent = def.icon;
  const outgoing = allEdges.filter((e) => e.source === agentConfig.name);
  const incoming = allEdges.filter((e) => e.target === agentConfig.name);

  return (
    <div className="bg-background/80 backdrop-blur-xl border border-border/20 rounded-xl shadow-lg p-4 w-80">
      <div className="flex items-center gap-2 mb-3">
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
            def.doveCard.iconBg,
            def.doveCard.iconColor,
          )}
        >
          <IconComponent className="w-3.5 h-3.5" />
        </div>
        <p className="text-sm font-semibold text-foreground flex-1 truncate">{def.displayName}</p>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-[10px] text-muted-foreground mb-3 line-clamp-2">{def.description}</p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-primary/70 mb-1.5">
            Outgoing →
          </p>
          {outgoing.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50">None</p>
          ) : (
            outgoing.map((e) => {
              const s = e.data?.strategy ?? "chat";
              return (
                <div key={e.id} className="flex items-center gap-1 mb-1.5 min-w-0">
                  <span
                    style={{ color: STRATEGY_COLORS[s], borderColor: `${STRATEGY_COLORS[s]}40` }}
                    className="text-[9px] font-medium px-1 py-0.5 rounded-full border shrink-0"
                  >
                    {STRATEGY_LABELS[s]}
                  </span>
                  <span className="text-[10px] text-foreground truncate">{e.target}</span>
                </div>
              );
            })
          )}
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-primary/70 mb-1.5">
            ← Incoming
          </p>
          {incoming.length === 0 ? (
            <p className="text-[10px] text-muted-foreground/50">None</p>
          ) : (
            incoming.map((e) => {
              const s = e.data?.strategy ?? "chat";
              return (
                <div key={e.id} className="flex items-center gap-1 mb-1.5 min-w-0">
                  <span className="text-[10px] text-foreground truncate">{e.source}</span>
                  <span
                    style={{ color: STRATEGY_COLORS[s], borderColor: `${STRATEGY_COLORS[s]}40` }}
                    className="text-[9px] font-medium px-1 py-0.5 rounded-full border shrink-0"
                  >
                    {STRATEGY_LABELS[s]}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <button
        onClick={() => onAddLink(agentConfig.name)}
        className="mt-3 w-full text-[11px] font-medium text-primary hover:text-primary/80 flex items-center justify-center gap-1 border border-primary/20 rounded-lg py-1.5 hover:bg-primary/5 transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add link from here
      </button>
    </div>
  );
}

// ─── AddLinkDialog ────────────────────────────────────────────────────────────

interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentConfigs: AgentConfigEntry[];
  initialSource?: string;
  initialTarget?: string;
  existingEdges: AgentFlowEdge[];
  onSuccess: (edge: AgentFlowEdge) => void;
}

function AddLinkDialog({
  open,
  onOpenChange,
  agentConfigs,
  initialSource,
  initialTarget,
  existingEdges,
  onSuccess,
}: AddLinkDialogProps) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [direction, setDirection] = useState<"single" | "dual">("single");
  const [strategy, setStrategy] = useState<AgentLinkStrategy>("chat");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setSource(initialSource ?? "");
      setTarget(initialTarget ?? "");
      setDirection("single");
      setStrategy("chat");
      setError("");
    }
  }, [open, initialSource, initialTarget]);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!source || !target) {
      setError("Both source and target are required.");
      return;
    }
    if (source === target) {
      setError("An agent cannot link to itself.");
      return;
    }

    const edgeId = buildEdgeId(source, target, strategy);
    const reverseId = buildEdgeId(target, source, strategy);
    if (existingEdges.some((existing) => existing.id === edgeId || existing.id === reverseId)) {
      setError(`A "${strategy}" link between these agents already exists.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/agent-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target, direction, strategy }),
      });
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to create link.");
        return;
      }
      onSuccess(buildFlowEdge(source, target, direction, strategy));
      onOpenChange(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const isSourceLocked = !!initialSource;
  const isTargetLocked = !!initialTarget;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Agent Link</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Source agent</label>
            {isSourceLocked ? (
              <p className="text-sm font-medium bg-muted rounded-md px-3 py-2 text-foreground">
                {agentConfigs.find((c) => c.name === source)?.displayName ?? source}
              </p>
            ) : (
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source…" />
                </SelectTrigger>
                <SelectContent>
                  {agentConfigs.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Target agent</label>
            {isTargetLocked ? (
              <p className="text-sm font-medium bg-muted rounded-md px-3 py-2 text-foreground">
                {agentConfigs.find((c) => c.name === target)?.displayName ?? target}
              </p>
            ) : (
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Select target…" />
                </SelectTrigger>
                <SelectContent>
                  {agentConfigs.map((c) => (
                    <SelectItem key={c.name} value={c.name}>
                      {c.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Strategy</label>
            <Select
              value={strategy}
              onValueChange={(v) =>
                setStrategy(AGENT_LINK_STRATEGIES.find((s) => s === v) ?? "chat")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGENT_LINK_STRATEGIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    <span style={{ color: STRATEGY_COLORS[s] }} className="font-medium">
                      {STRATEGY_LABELS[s]}
                    </span>
                    <span className="text-muted-foreground text-xs ml-1.5">
                      {STRATEGY_DESCRIPTIONS[s]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Direction</label>
            <Select
              value={direction}
              onValueChange={(v) => setDirection(v === "dual" ? "dual" : "single")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single → (source to target only)</SelectItem>
                <SelectItem value="dual">Bidirectional ↔ (both directions)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? "Adding…" : "Add Link"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Layout ───────────────────────────────────────────────────────────────────

type LayoutAlgorithm = "layered" | "stress" | "force" | "radial" | "mrtree";
type LayoutDirection = "DOWN" | "UP" | "RIGHT" | "LEFT";

interface CanvasLayout {
  algorithm: LayoutAlgorithm;
  direction: LayoutDirection;
}

const DEFAULT_LAYOUT: CanvasLayout = { algorithm: "layered", direction: "DOWN" };

const LAYOUT_ALGORITHMS: { value: LayoutAlgorithm; label: string }[] = [
  { value: "layered", label: "Layered" },
  { value: "stress", label: "Stress" },
  { value: "force", label: "Force" },
  { value: "radial", label: "Radial" },
  { value: "mrtree", label: "Tree" },
];

const LAYOUT_DIRECTIONS: { value: LayoutDirection; label: string }[] = [
  { value: "DOWN", label: "↓ Down" },
  { value: "UP", label: "↑ Up" },
  { value: "RIGHT", label: "→ Right" },
  { value: "LEFT", label: "← Left" },
];

const elk = new ELK();

async function applyElkLayout(
  nodes: AnyFlowNode[],
  edges: AgentFlowEdge[],
  canvasLayout: CanvasLayout,
): Promise<AnyFlowNode[]> {
  // Compute group sizes and member positions using the same grid logic as init,
  // so auto-layout and default placement are always consistent.
  const groupSizes: Record<string, { width: number; height: number }> = {};
  const memberGridPositions: Record<string, { x: number; y: number }> = {};

  for (const groupNode of nodes.filter(isGroupNode)) {
    const members = groupNode.data.group.members;
    const size = groupNodeSize(members.length, maxParallelEdgesInGroup(members, edges));
    groupSizes[groupNode.id] = size;
    members.forEach((memberId, idx) => {
      memberGridPositions[memberId] = memberPositionInGroup(
        idx,
        members.length,
        size.width,
        size.height,
      );
    });
  }

  // Pass 2 (outer): layout top-level nodes using computed group sizes.
  const opts: Record<string, string> = {
    "elk.algorithm": canvasLayout.algorithm,
    "elk.spacing.nodeNode": "160",
  };
  if (canvasLayout.algorithm === "layered") {
    opts["elk.direction"] = canvasLayout.direction;
    opts["elk.layered.spacing.nodeNodeBetweenLayers"] = "200";
    opts["elk.layered.nodePlacement.strategy"] = "NETWORK_SIMPLEX";
  } else if (canvasLayout.algorithm === "stress") {
    opts["elk.stress.desiredEdgeLength"] = "400";
  }

  const topLevel = nodes.filter((n) => !n.parentId);
  const topLevelIds = new Set(topLevel.map((n) => n.id));
  const topLevelEdges = edges.filter((e) => topLevelIds.has(e.source) && topLevelIds.has(e.target));

  const outerResult = await elk.layout({
    id: "root",
    layoutOptions: opts,
    children: topLevel.map((n) => ({
      id: n.id,
      width: groupSizes[n.id]?.width ?? styleNum(n.style, "width") ?? NODE_W,
      height: groupSizes[n.id]?.height ?? styleNum(n.style, "height") ?? NODE_H,
    })),
    edges: topLevelEdges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });

  return nodes.map((node) => {
    if (node.parentId) {
      const pos = memberGridPositions[node.id];
      return pos ? { ...node, position: pos } : node;
    }
    const en = outerResult.children?.find((c) => c.id === node.id);
    const size = groupSizes[node.id];
    return {
      ...node,
      position: { x: en?.x ?? node.position.x, y: en?.y ?? node.position.y },
      ...(size ? { style: { ...node.style, width: size.width, height: size.height } } : {}),
    };
  });
}

interface LayoutPanelProps {
  layout: CanvasLayout;
  onApply: (layout: CanvasLayout) => void;
}

function LayoutPanel({ layout, onApply }: LayoutPanelProps) {
  return (
    <div className="bg-background/80 backdrop-blur-xl border border-border/20 rounded-xl shadow-lg p-4 min-w-48">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
        Auto Layout
      </p>
      <p className="text-[9px] font-semibold uppercase tracking-widest text-primary/70 mb-1.5">
        Algorithm
      </p>
      <div className="flex flex-col gap-1 mb-3">
        {LAYOUT_ALGORITHMS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onApply({ ...layout, algorithm: value })}
            className={cn(
              "text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors",
              layout.algorithm === value
                ? "bg-primary text-primary-foreground font-medium"
                : "text-foreground hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {layout.algorithm === "layered" && (
        <>
          <p className="text-[9px] font-semibold uppercase tracking-widest text-primary/70 mb-1.5">
            Direction
          </p>
          <div className="grid grid-cols-2 gap-1">
            {LAYOUT_DIRECTIONS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onApply({ ...layout, direction: value })}
                className={cn(
                  "text-left text-xs px-2.5 py-1.5 rounded-lg transition-colors",
                  layout.direction === value
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-foreground hover:bg-muted",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── UnlinkedAgentsSidebar ───────────────────────────────────────────────────

interface UnlinkedAgentsSidebarProps {
  agents: AgentConfigEntry[];
}

function UnlinkedAgentsSidebar({ agents }: UnlinkedAgentsSidebarProps) {
  if (agents.length === 0) return null;
  return (
    <div className="w-56 shrink-0 h-full bg-sidebar border-r border-border/20 flex flex-col overflow-hidden">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground px-3 pt-3 pb-2">
        Unlinked agents
      </p>
      <div className="flex-1 overflow-y-auto px-2 pb-3 flex flex-col gap-1.5">
        {agents.map((config) => {
          const def = buildAgentDef(config);
          const IconComponent = def.icon;
          return (
            <div
              key={config.name}
              draggable
              onDragStart={(e) => e.dataTransfer.setData("agentName", config.name)}
              className="flex items-center gap-2 p-2 rounded-lg border border-border/30 bg-card/60 cursor-grab hover:bg-card/80 transition-colors select-none"
            >
              <div
                className={cn(
                  "w-6 h-6 rounded-md flex items-center justify-center shrink-0",
                  def.doveCard.iconBg,
                  def.doveCard.iconColor,
                )}
              >
                <IconComponent className="w-3 h-3" />
              </div>
              <span
                className="text-xs font-medium text-foreground truncate"
                title={def.displayName}
              >
                {def.displayName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── CreateGroupDialog ───────────────────────────────────────────────────────

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingGroupNames: string[];
  onSuccess: (groupName: string) => void;
}

export function CreateGroupDialog({
  open,
  onOpenChange,
  existingGroupNames,
  onSuccess,
}: CreateGroupDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setError("");
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Group name is required.");
      return;
    }
    if (existingGroupNames.includes(trimmed)) {
      setError(`Group "${trimmed}" already exists.`);
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/settings/agent-links/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Failed to create group.");
        return;
      }
      onSuccess(trimmed);
      onOpenChange(false);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Group</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="space-y-4 pt-1"
        >
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Group name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering"
              disabled={submitting}
              className="w-full text-sm bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── AgentLinksCanvas ────────────────────────────────────────────────────────

export interface AgentLinksCanvasProps {
  agentConfigs: AgentConfigEntry[];
  linksFile: AgentLinksFile;
}

function AgentLinksCanvasInner({ agentConfigs, linksFile }: AgentLinksCanvasProps) {
  const statuses = useAgentHeartbeat();
  const { screenToFlowPosition } = useReactFlow();

  const [nodes, setNodes] = useState<AnyFlowNode[]>([]);
  const [edges, setEdges] = useState<AgentFlowEdge[]>([]);

  // Initialise after mount so localStorage is available.
  // Groups with ≥2 members appear as container nodes; their members are child nodes.
  // Linked-only or manually-placed agents appear as standalone nodes.
  // React Flow requires parent nodes to precede their children in the array.
  useEffect(() => {
    const saved = loadPositions();
    const placed = loadPlacedAgents();

    const linkedNames = new Set<string>();
    for (const link of linksFile.links) {
      linkedNames.add(link.source);
      linkedNames.add(link.target);
    }

    // Render all groups (including empty ones the user just created) so they
    // are visible on the canvas as drop targets for assigning members.
    const validGroups = linksFile.groups;
    const groupMemberNames = new Set<string>(validGroups.flatMap((g) => g.members));

    const groupNodes: GroupFlowNode[] = [];
    const groupMemberNodes: AgentFlowNode[] = [];

    validGroups.forEach((group, gi) => {
      const groupId = `group:${group.name}`;
      const maxParallel = maxParallelEdgesInGroup(group.members, linksFile.links);
      const defaults = groupNodeSize(group.members.length, maxParallel);
      const savedState = saved[groupId];
      groupNodes.push({
        id: groupId,
        type: "groupNode",
        zIndex: 0,
        position: savedState ?? gridPosition(gi, validGroups.length),
        style: {
          width: Math.max(savedState?.w ?? 0, defaults.width),
          height: Math.max(savedState?.h ?? 0, defaults.height),
        },
        data: { group },
      });

      group.members.forEach((memberName, mi) => {
        const config = agentConfigs.find((c) => c.name === memberName);
        if (!config) return;
        groupMemberNodes.push({
          id: memberName,
          type: "agentNode",
          parentId: groupId,
          extent: "parent" as const,
          position:
            saved[memberName] ??
            memberPositionInGroup(
              mi,
              group.members.length,
              Math.max(savedState?.w ?? 0, defaults.width),
              Math.max(savedState?.h ?? 0, defaults.height),
            ),
          data: { config },
        });
      });
    });

    // Standalone agent nodes: linked or placed, not already in a group.
    const onCanvas = agentConfigs.filter(
      (c) => (linkedNames.has(c.name) || placed.has(c.name)) && !groupMemberNames.has(c.name),
    );
    const standaloneNodes: AgentFlowNode[] = onCanvas.map((config, index) => ({
      id: config.name,
      type: "agentNode" as const,
      position: saved[config.name] ?? gridPosition(validGroups.length + index, onCanvas.length),
      data: { config },
    }));

    setNodes([...groupNodes, ...groupMemberNodes, ...standaloneNodes]);
    setEdges(
      linksFile.links.map((link) =>
        buildFlowEdge(link.source, link.target, link.direction, link.strategy),
      ),
    );
  }, [agentConfigs, linksFile.links, linksFile.groups]);

  const [showLegend, setShowLegend] = useState(true);
  const [showLayout, setShowLayout] = useState(false);
  const [layout, setLayout] = useState<CanvasLayout>(DEFAULT_LAYOUT);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInitialSource, setDialogInitialSource] = useState<string | undefined>();
  const [dialogInitialTarget, setDialogInitialTarget] = useState<string | undefined>();
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);

  // Apply node changes every frame; persist positions only on drag-end.
  const onNodesChange = useCallback((changes: NodeChange<AnyFlowNode>[]) => {
    setNodes((prev) => {
      const groupNodes = prev.filter(isGroupNode);

      const clamped = changes.map((c) => {
        if (c.type !== "position" || !c.position) return c;
        const existing = prev.find((n) => n.id === c.id);

        // Clamp group members above the title bar.
        if (existing?.parentId) {
          return c.position.y < GROUP_PAD_TOP
            ? { ...c, position: { ...c.position, y: GROUP_PAD_TOP } }
            : c;
        }

        // Don't clamp the group box itself — it would collide with its own
        // previous-position rect in `groupNodes` and snap back every frame.
        if (existing && isGroupNode(existing)) return c;

        // Block standalone nodes from entering any group box (every drag frame).
        const groupRects = groupNodes.map((g) => ({
          x: g.position.x,
          y: g.position.y,
          w: styleNum(g.style, "width") ?? 0,
          h: styleNum(g.style, "height") ?? 0,
        }));
        const clampedPos = clampOutsideRects(
          { x: c.position.x, y: c.position.y, w: NODE_W, h: NODE_H },
          groupRects,
        );
        return clampedPos.x !== c.position.x || clampedPos.y !== c.position.y
          ? { ...c, position: clampedPos }
          : c;
      });
      const next = applyNodeChanges(clamped, prev);
      if (changes.some((c) => c.type === "position" && c.dragging === false)) {
        savePositions(next);
      }
      return next;
    });
  }, []);

  // Intercept drag-to-connect: open dialog pre-filled, do NOT add edge yet
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    setDialogInitialSource(connection.source);
    setDialogInitialTarget(connection.target);
    setDialogOpen(true);
  }, []);

  // Optimistic edge delete with rollback on failure
  const handleEdgeDelete = useCallback(
    async (edgeId: string, data: AgentEdgeData) => {
      const edge = edges.find((e) => e.id === edgeId);
      if (!edge) return;

      setEdges((prev) => prev.filter((e) => e.id !== edgeId));

      try {
        const res = await fetch("/api/settings/agent-links", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: edge.source,
            target: edge.target,
            strategy: data.strategy,
          }),
        });
        if (!res.ok) setEdges((prev) => [...prev, edge]);
      } catch {
        setEdges((prev) => [...prev, edge]);
      }
    },
    [edges],
  );

  const handleApplyLayout = useCallback(
    async (newLayout: CanvasLayout) => {
      setLayout(newLayout);
      setShowLayout(false);
      const newNodes = await applyElkLayout(nodes, edges, newLayout);
      setNodes(newNodes);
      savePositions(newNodes);
    },
    [nodes, edges],
  );

  // When a link is added, ensure both endpoints exist as nodes on the canvas.
  const handleAddLinkSuccess = useCallback(
    (newEdge: AgentFlowEdge) => {
      setEdges((prev) => [...prev, newEdge]);
      setNodes((prev) => {
        const toAdd: AgentFlowNode[] = [];
        for (const name of [newEdge.source, newEdge.target]) {
          if (!prev.some((n) => n.id === name)) {
            const config = agentConfigs.find((c) => c.name === name);
            if (config) {
              toAdd.push({
                id: name,
                type: "agentNode",
                position: gridPosition(prev.length + toAdd.length, agentConfigs.length),
                data: { config },
              });
              addPlacedAgent(name);
            }
          }
        }
        if (toAdd.length === 0) return prev;
        const next = [...prev, ...toAdd];
        savePositions(next);
        return next;
      });
    },
    [agentConfigs],
  );

  // Add a freshly-created (empty) group as a node on the canvas, positioned
  // near the centre of the current viewport so the user sees it immediately.
  const handleGroupCreated = useCallback(
    (groupName: string) => {
      const size = groupNodeSize(0, 0);
      const center = screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
      const newGroup: GroupFlowNode = {
        id: `group:${groupName}`,
        type: "groupNode",
        zIndex: 0,
        position: { x: center.x - size.width / 2, y: center.y - size.height / 2 },
        style: { width: size.width, height: size.height },
        data: { group: { name: groupName, members: [], description: "" } },
      };
      setNodes((prev) => {
        // React Flow requires parent nodes to precede their children.
        const next: AnyFlowNode[] = [newGroup, ...prev];
        savePositions(next);
        return next;
      });
    },
    [screenToFlowPosition],
  );

  // Update canvas nodes after group members change (add/remove child nodes).
  const handleMembersUpdated = useCallback(
    (groupName: string, newMembers: string[]) => {
      setNodes((prev) => {
        const groupId = `group:${groupName}`;
        const groupNode = prev.find((n): n is GroupFlowNode => n.id === groupId && isGroupNode(n));
        if (!groupNode) return prev;

        const prevMembers = groupNode.data.group.members;
        const added = newMembers.filter((m) => !prevMembers.includes(m));
        const removedNames = prevMembers.filter((m) => !newMembers.includes(m));
        const removedSet = new Set(removedNames);

        const minSize = groupNodeSize(
          newMembers.length,
          maxParallelEdgesInGroup(newMembers, edges),
        );
        const updatedGroup: GroupFlowNode = {
          ...groupNode,
          data: { group: { ...groupNode.data.group, members: newMembers } },
          style: {
            ...groupNode.style,
            width: Math.max(styleNum(groupNode.style, "width") ?? 0, minSize.width),
            height: Math.max(styleNum(groupNode.style, "height") ?? 0, minSize.height),
          },
        };

        // Removed members that still have links must stay on canvas as standalone nodes
        // (removing the node would orphan their edges). Members with no links go to sidebar.
        const groupW = styleNum(groupNode.style, "width") ?? 400;
        const demotedNodes: AgentFlowNode[] = removedNames.flatMap((name) => {
          const hasLinks = edges.some((e) => e.source === name || e.target === name);
          if (!hasLinks) return [];
          const existingNode = prev.find(
            (n): n is AgentFlowNode => n.id === name && isAgentNode(n),
          );
          if (!existingNode) return [];
          const { parentId: _p, extent: _e, ...rest } = existingNode;
          return [
            {
              ...rest,
              position: { x: groupNode.position.x + groupW + 40, y: groupNode.position.y },
            },
          ];
        });

        const addedNodes: AgentFlowNode[] = added.flatMap((name) => {
          const config = agentConfigs.find((c) => c.name === name);
          if (!config) return [];
          return [
            {
              id: name,
              type: "agentNode" as const,
              parentId: groupId,
              extent: "parent" as const,
              position: memberPositionInGroup(
                newMembers.indexOf(name),
                newMembers.length,
                styleNum(updatedGroup.style, "width") ?? minSize.width,
                styleNum(updatedGroup.style, "height") ?? minSize.height,
              ),
              data: { config },
            },
          ];
        });

        // React Flow requires parent nodes to precede their children.
        const unsorted: AnyFlowNode[] = [
          ...prev.filter((n) => n.id !== groupId && !removedSet.has(n.id)),
          updatedGroup,
          ...addedNodes,
          ...demotedNodes,
        ];
        const next: AnyFlowNode[] = [
          ...unsorted.filter((n) => n.type === "groupNode"),
          ...unsorted.filter((n) => n.type !== "groupNode"),
        ];
        savePositions(next);
        return next;
      });
    },
    [agentConfigs, edges],
  );

  // Drop an agent from the sidebar onto the canvas.
  // If dropped inside a group's bounding box, add it as a group member.
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const agentName = e.dataTransfer.getData("agentName");
      if (!agentName) return;
      if (nodes.some((n) => n.id === agentName)) return;

      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

      const targetGroup = nodes.find((n): n is GroupFlowNode => {
        if (n.type !== "groupNode") return false;
        const w = styleNum(n.style, "width") ?? 0;
        const h = styleNum(n.style, "height") ?? 0;
        return (
          position.x >= n.position.x &&
          position.x <= n.position.x + w &&
          position.y >= n.position.y &&
          position.y <= n.position.y + h
        );
      });

      if (targetGroup) {
        const group = targetGroup.data.group;
        const newMembers = [...group.members, agentName];
        void putGroupMembers(group.name, newMembers).then((res) => {
          if (res.ok) handleMembersUpdated(group.name, newMembers);
        });
        return;
      }

      // Standalone drop
      setNodes((prev) => {
        if (prev.some((n) => n.id === agentName)) return prev;
        const config = agentConfigs.find((c) => c.name === agentName);
        if (!config) return prev;
        const newNode: AgentFlowNode = {
          id: agentName,
          type: "agentNode",
          position,
          data: { config },
        };
        const next = [...prev, newNode];
        savePositions(next);
        addPlacedAgent(agentName);
        return next;
      });
    },
    [agentConfigs, screenToFlowPosition, nodes, handleMembersUpdated],
  );

  const handleRemoveNode = useCallback((nodeId: string) => {
    setNodes((prev) => {
      const node = prev.find((n) => n.id === nodeId);
      // If node is a group member, remove it from the group in the backend too.
      if (node?.parentId) {
        const groupNode = prev.find(
          (n): n is GroupFlowNode => n.id === node.parentId && isGroupNode(n),
        );
        if (groupNode) {
          const newMembers = groupNode.data.group.members.filter((m) => m !== nodeId);
          void putGroupMembers(groupNode.data.group.name, newMembers);
        }
      }
      const next = prev.filter((n) => n.id !== nodeId);
      savePositions(next);
      return next;
    });
    removePlacedAgent(nodeId);
    setSelectedNodeId((prev) => (prev === nodeId ? null : prev));
  }, []);

  const openAddDialog = useCallback((source?: string) => {
    setDialogInitialSource(source);
    setDialogInitialTarget(undefined);
    setDialogOpen(true);
  }, []);

  const selectedConfig = selectedNodeId
    ? agentConfigs.find((c) => c.name === selectedNodeId)
    : null;

  const sidebarAgents = agentConfigs.filter((c) => !nodes.some((n) => n.id === c.name));

  const editingGroupMembers = editingGroup
    ? (nodes.find((n): n is GroupFlowNode => n.id === `group:${editingGroup}` && isGroupNode(n))
        ?.data.group.members ?? [])
    : [];

  return (
    <HeartbeatContext.Provider value={statuses}>
      <EdgesContext.Provider value={edges}>
        <RemoveNodeContext.Provider value={handleRemoveNode}>
          <DeleteEdgeContext.Provider value={handleEdgeDelete}>
            <EditGroupContext.Provider value={setEditingGroup}>
              <div className="w-full h-screen flex">
                <UnlinkedAgentsSidebar agents={sidebarAgents} />
                <div
                  className="flex-1 h-full"
                  onDrop={onDrop}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    defaultEdgeOptions={{ zIndex: 1000 }}
                    onNodesChange={onNodesChange}
                    onConnect={onConnect}
                    onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                    onPaneClick={() => setSelectedNodeId(null)}
                    connectionMode={ConnectionMode.Loose}
                    deleteKeyCode={null}
                    fitView
                    panOnDrag
                    panOnScroll
                    selectionOnDrag
                    zoomOnDoubleClick={false}
                  >
                    <Background bgColor="var(--sidebar)" />
                    <Controls position="bottom-left" />

                    {/* Top-left: nav + add link */}
                    <Panel position="top-left">
                      <div className="flex items-center gap-2.5 bg-background/80 backdrop-blur-xl border border-border/20 rounded-xl shadow-lg px-3 py-2">
                        <Link
                          href="/"
                          className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 text-xs font-medium"
                        >
                          <Home className="w-3.5 h-3.5" />
                          Home
                        </Link>
                        <span className="text-border">·</span>
                        <Link
                          href="/settings/agent-links"
                          className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 text-xs font-medium"
                        >
                          <List className="w-3.5 h-3.5" />
                          List view
                        </Link>
                        <span className="text-border">·</span>
                        <button
                          onClick={() => openAddDialog()}
                          className="text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5 text-xs font-medium"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Link
                        </button>
                        <span className="text-border">·</span>
                        <button
                          onClick={() => setCreateGroupOpen(true)}
                          className="text-primary hover:text-primary/80 transition-colors flex items-center gap-1.5 text-xs font-medium"
                        >
                          <FolderPlus className="w-3.5 h-3.5" />
                          New Group
                        </button>
                      </div>
                    </Panel>

                    {/* Top-right: layout + legend toggles */}
                    <Panel position="top-right">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setShowLayout((v) => !v);
                            setShowLegend(false);
                          }}
                          className={cn(
                            "bg-background/80 backdrop-blur-xl border border-border/20 rounded-xl shadow-lg p-2.5 transition-colors",
                            showLayout
                              ? "text-primary bg-primary/10 border-primary/20"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          title={showLayout ? "Hide layout options" : "Auto layout"}
                        >
                          <LayoutGrid className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            setShowLegend((v) => !v);
                            setShowLayout(false);
                          }}
                          className={cn(
                            "bg-background/80 backdrop-blur-xl border border-border/20 rounded-xl shadow-lg p-2.5 transition-colors",
                            showLegend
                              ? "text-primary bg-primary/10 border-primary/20"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                          title={showLegend ? "Hide legend" : "Show legend"}
                        >
                          <Info className="w-4 h-4" />
                        </button>
                      </div>
                    </Panel>

                    {/* Top-right dropdown: layout panel */}
                    {showLayout && (
                      <Panel position="top-right" style={{ top: 56 }}>
                        <LayoutPanel layout={layout} onApply={handleApplyLayout} />
                      </Panel>
                    )}

                    {/* Bottom-right: legend */}
                    {showLegend && (
                      <Panel position="bottom-right">
                        <AgentLinksLegend />
                      </Panel>
                    )}

                    {/* Bottom-center: selected agent info */}
                    {selectedConfig && (
                      <Panel position="bottom-center">
                        <SelectedAgentPanel
                          agentConfig={selectedConfig}
                          allEdges={edges}
                          onClose={() => setSelectedNodeId(null)}
                          onAddLink={openAddDialog}
                        />
                      </Panel>
                    )}
                  </ReactFlow>
                </div>
              </div>

              <AddLinkDialog
                open={dialogOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    setDialogInitialSource(undefined);
                    setDialogInitialTarget(undefined);
                  }
                  setDialogOpen(open);
                }}
                agentConfigs={agentConfigs}
                initialSource={dialogInitialSource}
                initialTarget={dialogInitialTarget}
                existingEdges={edges}
                onSuccess={handleAddLinkSuccess}
              />
              <EditGroupMembersDialog
                groupName={editingGroup}
                onOpenChange={(open) => {
                  if (!open) setEditingGroup(null);
                }}
                allAgentConfigs={agentConfigs}
                currentMembers={editingGroupMembers}
                onSuccess={handleMembersUpdated}
              />
              <CreateGroupDialog
                open={createGroupOpen}
                onOpenChange={setCreateGroupOpen}
                existingGroupNames={nodes.filter(isGroupNode).map((n) => n.data.group.name)}
                onSuccess={handleGroupCreated}
              />
            </EditGroupContext.Provider>
          </DeleteEdgeContext.Provider>
        </RemoveNodeContext.Provider>
      </EdgesContext.Provider>
    </HeartbeatContext.Provider>
  );
}

export function AgentLinksCanvas(props: AgentLinksCanvasProps) {
  return (
    <ReactFlowProvider>
      <AgentLinksCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
