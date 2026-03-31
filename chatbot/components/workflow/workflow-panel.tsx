"use client";

import * as React from "react";
import type { Edge, Node as FlowNode } from "@xyflow/react";
import { Canvas } from "@/components/ai-elements/canvas";
import { Edge as WorkflowEdge } from "@/components/ai-elements/edge";
import { Node } from "@/components/ai-elements/node";
import { ProgressNode, type ProgressNodeData } from "./progress-node";
import { GitBranchPlus, OctagonX } from "lucide-react";
import type { ChatMessage } from "@/components/hooks/use-messages";

const NODE_GAP_Y = 40;
const NODE_WIDTH = 256; // w-64
const CIRCLE_SIZE = 32;
const CIRCLE_X = (NODE_WIDTH - CIRCLE_SIZE) / 2;

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

interface WorkflowEntry {
  message: string;
  artifacts: Record<string, string>;
  isCancelled?: boolean;
  isCompleted?: boolean;
}

function buildGraph(entries: WorkflowEntry[]): {
  nodes: FlowNode[];
  edges: Edge[];
} {
  let y = 0;

  const nodes: FlowNode[] = entries.map((entry, i) => {
    const isFirst = i === 0;
    const isCircle = isFirst || !!entry.isCancelled || !!entry.isCompleted;
    const circleVariant: CircleVariant = isFirst
      ? "start"
      : entry.isCompleted
        ? "completed"
        : "stopped";
    const node: FlowNode = {
      id: `node-${i}`,
      type: isCircle ? "circle" : "progress",
      position: { x: isCircle ? CIRCLE_X : 0, y },
      data: isCircle
        ? ({ variant: circleVariant } satisfies CircleNodeData)
        : ({
            message: entry.message,
            artifacts: entry.artifacts,
            index: i,
            isLast: i === entries.length - 1,
          } satisfies ProgressNodeData),
      draggable: false,
      selectable: false,
    };
    y += (isCircle ? CIRCLE_SIZE : estimateNodeHeight(entry)) + NODE_GAP_Y;
    return node;
  });

  const edges: Edge[] = entries.slice(1).map((_, i) => ({
    id: `edge-${i}`,
    source: `node-${i}`,
    target: `node-${i + 1}`,
    type: "animated",
  }));

  return { nodes, edges };
}

interface WorkflowPanelProps {
  messages: ChatMessage[];
  processing?: boolean;
}

export function WorkflowPanel({ messages, processing = false }: WorkflowPanelProps) {
  const activeMsg = React.useMemo(
    () =>
      messages
        .toReversed()
        .find((m) => m.role === "assistant" && m.agentProgress && m.agentProgress.length > 0),
    [messages],
  );

  const { nodes, edges } = React.useMemo(() => {
    if (!activeMsg?.agentProgress) return { nodes: [], edges: [] };
    const base = activeMsg.agentProgress;
    const entries = activeMsg.isCancelled
      ? [...base, { message: "Stopped by user", artifacts: {}, isCancelled: true }]
      : !activeMsg.isLoading && !processing
        ? [...base, { message: "Completed", artifacts: {}, isCompleted: true }]
        : base;
    return buildGraph(entries);
  }, [activeMsg]);

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
