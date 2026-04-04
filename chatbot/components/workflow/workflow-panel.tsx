"use client";

import * as React from "react";
import type { Edge, Node as FlowNode } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { Canvas } from "@/components/ai-elements/canvas";
import { Edge as WorkflowEdge } from "@/components/ai-elements/edge";
import { Node } from "@/components/ai-elements/node";
import { ProgressNode, type ProgressNodeData } from "./progress-node";
import { GitBranchPlus, OctagonX } from "lucide-react";
import type { ChatMessage } from "@/components/hooks/use-messages";

const NODE_WIDTH = 256; // w-64
const CIRCLE_SIZE = 32;

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
    start:
      "bg-primary! border-primary/60! shadow-[0_0_16px_4px_rgba(var(--primary),0.5),0_0_32px_8px_rgba(var(--primary),0.2)]!",
    stopped:
      "bg-amber-500! border-amber-400/60! shadow-[0_0_16px_4px_rgba(245,158,11,0.5),0_0_32px_8px_rgba(245,158,11,0.2)]!",
    completed:
      "bg-emerald-500! border-emerald-400/60! shadow-[0_0_16px_4px_rgba(16,185,129,0.5),0_0_32px_8px_rgba(16,185,129,0.2)]!",
  };
  return (
    <Node
      handles={{ target: data.variant !== "start", source: data.variant === "start" }}
      className={`w-8! h-8! min-w-0! rounded-full! p-0! ${styles[data.variant]}`}
    />
  );
}

function AutoFitView({ nodes }: { nodes: FlowNode[] }) {
  const { fitView } = useReactFlow();
  React.useEffect(() => {
    void fitView({ padding: 0.2, duration: 200 });
  }, [nodes, fitView]);
  return null;
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

export function buildGraph(entries: WorkflowEntry[]): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  const seenNodes = new Map<string, string>();
  const seenEdges = new Set<string>();
  const nodeSizes = new Map<string, { w: number; h: number }>();
  let prevNodeId: string | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isFirst = i === 0;
    const isCircle = isFirst || !!entry.isCancelled || !!entry.isCompleted;
    const isLast = i === entries.length - 1;

    const existingNodeId = !isCircle
      ? seenNodes.get(progressNodeKey(entry.message, entry.artifacts))
      : undefined;
    const nodeId = existingNodeId ?? `node-${i}`;

    if (prevNodeId !== null && prevNodeId !== nodeId) {
      const edgeKey = `${prevNodeId}->${nodeId}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        edges.push({ id: `edge-${edgeKey}`, source: prevNodeId, target: nodeId, type: "animated" });
      }
    }

    prevNodeId = nodeId;

    if (existingNodeId !== undefined) {
      if (isLast) {
        const existing = nodes.find((n) => n.id === existingNodeId);
        if (existing) existing.data = { ...existing.data, isLast: true };
      }
      continue;
    }

    if (!isCircle) seenNodes.set(progressNodeKey(entry.message, entry.artifacts), nodeId);

    const circleVariant: CircleVariant = isFirst
      ? "start"
      : entry.isCompleted
        ? "completed"
        : "stopped";
    const w = isCircle ? CIRCLE_SIZE : NODE_WIDTH;
    const h = isCircle ? CIRCLE_SIZE : estimateNodeHeight(entry);
    nodeSizes.set(nodeId, { w, h });

    nodes.push({
      id: nodeId,
      type: isCircle ? "circle" : "progress",
      position: { x: 0, y: 0 },
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

  // Dagre layout — top→bottom, handles DAGs with branches/merges
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 40, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const { w, h } = nodeSizes.get(node.id) ?? { w: NODE_WIDTH, h: 140 };
    g.setNode(node.id, { width: w, height: h });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- dagre graphlib types use `any` generics
  dagre.layout(g);

  for (const node of nodes) {
    // dagre.graphlib types are incomplete — node() returns {x,y,width,height,...}
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const pos: { x: number; y: number } = g.node(node.id);
    const { w, h } = nodeSizes.get(node.id) ?? { w: NODE_WIDTH, h: 140 };
    // Dagre returns center coords — convert to top-left for React Flow
    node.position = { x: pos.x - w / 2, y: pos.y - h / 2 };
  }

  return { nodes, edges };
}

interface WorkflowPanelProps {
  messages: ChatMessage[];
  isLoading: boolean;
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

export function WorkflowPanel({ messages, isLoading }: WorkflowPanelProps) {
  const activeMsg = React.useMemo(
    () =>
      messages
        .toReversed()
        .find((m) => m.role === "assistant" && m.agentProgress && m.agentProgress.length > 0),
    [messages],
  );

  const { nodes, edges } = React.useMemo(() => {
    if (!activeMsg?.agentProgress) return { nodes: [], edges: [] };
    const entries = buildEntries(
      activeMsg.agentProgress,
      isLoading,
      activeMsg.isCancelled ?? false,
    );
    return buildGraph(entries);
  }, [activeMsg, isLoading]);

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
      <div className="relative flex-1 min-h-0">
        <Canvas
          nodes={renderedNodes}
          edges={renderedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <AutoFitView nodes={renderedNodes} />
        </Canvas>
      </div>
    </div>
  );
}
