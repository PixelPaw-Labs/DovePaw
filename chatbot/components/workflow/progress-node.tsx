"use client";

import {
  Node,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/node";

export interface ProgressNodeData {
  message: string;
  artifacts: Record<string, string>;
  index: number;
  isLast: boolean;
}

const ARTIFACT_LABEL: Record<string, string> = {
  stream: "Output",
  "tool-call": "Tool",
  "final-output": "Result",
  thinking: "Thinking",
  error: "Error",
  repo: "Repo",
  workspace: "Workspace",
  source: "Source",
};

export function ProgressNode({ data }: { data: ProgressNodeData }) {
  const artifactEntries = Object.entries(data.artifacts);

  return (
    <Node handles={{ target: data.index > 0, source: !data.isLast }}>
      <NodeHeader>
        <NodeTitle>{data.message}</NodeTitle>
        <NodeDescription>Step {data.index + 1}</NodeDescription>
      </NodeHeader>
      {artifactEntries.length > 0 && (
        <NodeContent>
          {artifactEntries.map(([name, text]) => (
            <div key={name} className="flex flex-col gap-0.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                {ARTIFACT_LABEL[name] ?? name}
              </p>
              <p className="text-xs text-foreground/80 break-all line-clamp-2 font-mono leading-relaxed">
                {text.length > 120 ? `${text.slice(0, 120)}…` : text}
              </p>
            </div>
          ))}
        </NodeContent>
      )}
      <NodeFooter>
        <p className="text-[10px] text-muted-foreground">
          {artifactEntries.length > 0
            ? `${artifactEntries.length} artifact${artifactEntries.length > 1 ? "s" : ""}`
            : "No artifacts"}
        </p>
      </NodeFooter>
    </Node>
  );
}
