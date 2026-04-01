"use client";

import * as React from "react";
import type { Edge, Node as FlowNode } from "@xyflow/react";
import { Canvas } from "@/components/ai-elements/canvas";
import { Edge as WorkflowEdge } from "@/components/ai-elements/edge";
import { Node } from "@/components/ai-elements/node";
import { ProgressNode, type ProgressNodeData } from "./progress-node";
import { GitBranchPlus, OctagonX } from "lucide-react";
import type { ChatMessage } from "@/components/hooks/use-messages";
const NODE_WIDTH = 256; // w-64
const CIRCLE_SIZE = 32;
const NODE_SEP = 40; // horizontal gap between nodes in the same row
const ROW_GAP = 60; // vertical gap between rows
const PADDING = 40; // canvas inset on all sides

function estimateNodeHeight(entry: { artifacts: Record<string, string> }): number {
  const headerHeight = 60;
  const footerHeight = 40;
  const artifactCount = Object.keys(entry.artifacts).length;
  const contentHeight = artifactCount > 0 ? 24 + artifactCount * 52 : 0;
  return headerHeight + contentHeight + footerHeight;
}

type CircleVariant = "start" | "stopped" | "completed";

interface CircleNodeData {
  variant: CircleVariant;
}

function CircleNode({ data }: { data: CircleNodeData }) {
  const styles = {
    start: "bg-primary! border-primary/60!",
    stopped: "bg-amber-500! border-amber-400/60!",
    completed: "bg-emerald-500! border-emerald-400/60!",
  };
  return (
    <Node
      handles={{ target: data.variant !== "start", source: data.variant === "start" }}
      className={`w-8! h-8! min-w-0! rounded-full! p-0! ${styles[data.variant]}`}
    />
  );
}

const nodeTypes = { progress: ProgressNode, circle: CircleNode };
const edgeTypes = {
  animated: WorkflowEdge.Animated,
  temporary: WorkflowEdge.Temporary,
};

export interface WorkflowEntry {
  message: string;
  artifacts: Record<string, string>;
  isCancelled?: boolean;
  isCompleted?: boolean;
}

function progressNodeKey(message: string, artifacts: Record<string, string>): string {
  const artifactPart = Object.entries(artifacts)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}\x00${v}`)
    .join("\x01");
  return `${message}\x02${artifactPart}`;
}

export function buildGraph(
  entries: WorkflowEntry[],
  canvasWidth = 800,
): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  const seenNodes = new Map<string, string>(); // progressNodeKey -> nodeId
  const seenEdges = new Set<string>(); // "sourceId->targetId"
  const nodeHeights = new Map<string, number>(); // nodeId -> height for dagre
  let prevNodeId: string | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isFirst = i === 0;
    const isCircle = isFirst || !!entry.isCancelled || !!entry.isCompleted;
    const isLast = i === entries.length - 1;

    // Check for existing progress node with same message + artifacts
    const existingNodeId = !isCircle
      ? seenNodes.get(progressNodeKey(entry.message, entry.artifacts))
      : undefined;
    const nodeId = existingNodeId ?? `node-${i}`;

    // Add edge from previous node, skipping self-loops and duplicate source->target pairs
    if (prevNodeId !== null && prevNodeId !== nodeId) {
      const edgeKey = `${prevNodeId}->${nodeId}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        edges.push({
          id: `edge-${edgeKey}`,
          source: prevNodeId,
          target: nodeId,
          type: "animated",
        });
      }
    }

    prevNodeId = nodeId;

    if (existingNodeId !== undefined) {
      // Node already exists — update isLast if needed so source handle is correct
      if (isLast) {
        const existing = nodes.find((n) => n.id === existingNodeId);
        if (existing) {
          existing.data = { ...existing.data, isLast: true };
        }
      }
      continue;
    }

    // New node
    if (!isCircle) seenNodes.set(progressNodeKey(entry.message, entry.artifacts), nodeId);

    const circleVariant: CircleVariant = isFirst
      ? "start"
      : entry.isCompleted
        ? "completed"
        : "stopped";

    const h = isCircle ? CIRCLE_SIZE : estimateNodeHeight(entry);
    nodeHeights.set(nodeId, h);

    nodes.push({
      id: nodeId,
      type: isCircle ? "circle" : "progress",
      position: { x: 0, y: 0 }, // layout pass below sets final positions
      data: isCircle
        ? ({ variant: circleVariant } satisfies CircleNodeData)
        : ({
            message: entry.message,
            artifacts: entry.artifacts,
            index: i,
            isLast,
          } satisfies ProgressNodeData),
      draggable: false,
      selectable: false,
    });
  }

  // Two-pass wrapping layout: nodes flow left→right and wrap into new rows when
  // the next node would exceed the available canvas width.

  // Pass 1 — assign each node a row index and x offset, accumulate row heights.
  const available = Math.max(canvasWidth - PADDING * 2, NODE_WIDTH);
  type LayoutItem = { node: FlowNode; row: number; x: number; h: number };
  const items: LayoutItem[] = [];
  const rowHeights: number[] = [];
  let row = 0;
  let curX = PADDING;
  let rowMaxH = 0;

  for (const node of nodes) {
    const w = node.type === "circle" ? CIRCLE_SIZE : NODE_WIDTH;
    const h = nodeHeights.get(node.id) ?? CIRCLE_SIZE;

    if (curX > PADDING && curX + w > PADDING + available) {
      rowHeights.push(rowMaxH);
      row++;
      curX = PADDING;
      rowMaxH = 0;
    }

    items.push({ node, row, x: curX, h });
    curX += w + NODE_SEP;
    rowMaxH = Math.max(rowMaxH, h);
  }
  rowHeights.push(rowMaxH); // last row

  // Pass 2 — compute each row's top-Y offset, then set final positions.
  // Nodes shorter than their row are vertically centred within it.
  const rowY: number[] = [PADDING];
  for (let i = 1; i < rowHeights.length; i++) {
    rowY.push(rowY[i - 1] + rowHeights[i - 1] + ROW_GAP);
  }

  for (const { node, row: r, x, h } of items) {
    node.position = { x, y: rowY[r] + (rowHeights[r] - h) / 2 };
  }

  return { nodes, edges };
}

interface WorkflowPanelProps {
  messages: ChatMessage[];
}

export function buildEntries(
  base: WorkflowEntry[],
  isLoading: boolean,
  isCancelled: boolean,
): WorkflowEntry[] {
  if (isCancelled)
    return [...base, { message: "Stopped by user", artifacts: {}, isCancelled: true }];
  if (!isLoading) return [...base, { message: "Completed", artifacts: {}, isCompleted: true }];
  return base;
}

export function WorkflowPanel({ messages }: WorkflowPanelProps) {
  const activeMsg = React.useMemo(
    () =>
      messages
        .toReversed()
        .find((m) => m.role === "assistant" && m.agentProgress && m.agentProgress.length > 0),
    [messages],
  );

  const containerRef = React.useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = React.useState(800);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { nodes, edges } = React.useMemo(() => {
    if (!activeMsg?.agentProgress) return { nodes: [], edges: [] };
    const entries = buildEntries(
      activeMsg.agentProgress,
      activeMsg.isLoading ?? false,
      activeMsg.isCancelled ?? false,
    );
    return buildGraph(entries, canvasWidth);
  }, [activeMsg, canvasWidth]);

  const [renderedNodes, setRenderedNodes] = React.useState(nodes);
  const [renderedEdges, setRenderedEdges] = React.useState(edges);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setRenderedNodes(nodes);
      setRenderedEdges(edges);
    }, 300);
    return () => clearTimeout(t);
  }, [nodes, edges]);

  if (!activeMsg || nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground/40 px-6">
        <GitBranchPlus size={48} />
        <p className="text-xs text-center leading-relaxed">
          Workflow steps will appear here when an agent runs
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {activeMsg.isCancelled && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
          <OctagonX className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="text-xs text-amber-600 font-medium">Stopped by user</span>
        </div>
      )}
      <div ref={containerRef} className="relative flex-1 min-h-0">
        <Canvas
          nodes={renderedNodes}
          edges={renderedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, duration: 0 }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  );
}
