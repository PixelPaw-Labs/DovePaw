"use client";

import * as React from "react";
import type { Edge, Node } from "@xyflow/react";
import { Canvas } from "@/components/ai-elements/canvas";
import { Edge as WorkflowEdge } from "@/components/ai-elements/edge";
import { ProgressNode, type ProgressNodeData } from "./progress-node";
import { GitBranchPlus } from "lucide-react";
import { nanoid } from "nanoid";
import type { ChatMessage } from "@/components/hooks/use-messages";

const NODE_GAP_Y = 40;

function estimateNodeHeight(entry: { artifacts: Record<string, string> }): number {
  const headerHeight = 60;
  const footerHeight = 40;
  const artifactCount = Object.keys(entry.artifacts).length;
  const contentHeight = artifactCount > 0 ? 24 + artifactCount * 52 : 0;
  return headerHeight + contentHeight + footerHeight;
}

const nodeTypes = { progress: ProgressNode };
const edgeTypes = {
  animated: WorkflowEdge.Animated,
  temporary: WorkflowEdge.Temporary,
};

function buildGraph(entries: { message: string; artifacts: Record<string, string> }[]): {
  nodes: Node[];
  edges: Edge[];
} {
  let y = 0;
  const nodes: Node[] = entries.map((entry, i) => {
    const node: Node = {
      id: `node-${i}`,
      type: "progress",
      position: { x: 0, y },
      data: {
        message: entry.message,
        artifacts: entry.artifacts,
        index: i,
        isLast: i === entries.length - 1,
      } satisfies ProgressNodeData,
      draggable: false,
      selectable: false,
    };
    y += estimateNodeHeight(entry) + NODE_GAP_Y;
    return node;
  });

  const edges: Edge[] = entries.slice(1).map((_, i) => ({
    id: nanoid(),
    source: `node-${i}`,
    target: `node-${i + 1}`,
    type: "animated",
  }));

  return { nodes, edges };
}

interface WorkflowPanelProps {
  messages: ChatMessage[];
}

export function WorkflowPanel({ messages }: WorkflowPanelProps) {
  const activeMsg = React.useMemo(
    () =>
      messages
        .toReversed()
        .find((m) => m.role === "assistant" && m.agentProgress && m.agentProgress.length > 0),
    [messages],
  );

  const { nodes, edges } = React.useMemo(
    () =>
      activeMsg?.agentProgress ? buildGraph(activeMsg.agentProgress) : { nodes: [], edges: [] },
    [activeMsg],
  );

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
    <Canvas
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      minZoom={0.3}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    />
  );
}
