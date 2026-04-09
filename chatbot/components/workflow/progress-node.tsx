"use client";

import {
  Node,
  NodeContent,
  NodeDescription,
  NodeFooter,
  NodeHeader,
  NodeTitle,
} from "@/components/ai-elements/node";
import { ARTIFACT } from "@/lib/artifact-names";

export interface ProgressNodeData {
  message: string;
  artifacts: Record<string, string>;
  index: number;
  isLast: boolean;
  isCancelled?: boolean;
}

const ARTIFACT_LABEL: Record<string, string> = {
  [ARTIFACT.STREAM]: "Output",
  [ARTIFACT.TOOL_CALL]: "Tool",
  [ARTIFACT.FINAL_OUTPUT]: "Result",
  [ARTIFACT.THINKING]: "Thinking",
  error: "Error",
  repo: "Repo",
  workspace: "Workspace",
  source: "Source",
};

const ARTIFACT_COLOR: Record<string, string> = {
  [ARTIFACT.TOOL_CALL]: "text-violet-400",
  [ARTIFACT.STREAM]: "text-sky-400",
  [ARTIFACT.FINAL_OUTPUT]: "text-emerald-400",
  [ARTIFACT.THINKING]: "text-amber-400",
  error: "text-red-400",
  repo: "text-pink-400",
  workspace: "text-cyan-400",
  source: "text-indigo-400",
};

export function ProgressNode({ data }: { data: ProgressNodeData }) {
  const artifactEntries = Object.entries(data.artifacts).filter(([k]) => k !== "label");

  return (
    <Node
      handles={{ target: true, source: !data.isLast }}
      className={data.isCancelled ? "border-amber-500/30" : undefined}
    >
      {/* Top accent line */}
      <div
        className={`absolute top-0 left-4 right-4 h-px rounded-full ${
          data.isCancelled
            ? "bg-gradient-to-r from-transparent via-amber-500/60 to-transparent"
            : "bg-gradient-to-r from-transparent via-primary/50 to-transparent"
        }`}
      />

      <NodeHeader className={data.isCancelled ? "border-amber-500/20" : undefined}>
        <NodeTitle className={data.isCancelled ? "from-amber-400 to-amber-600" : undefined}>
          {data.artifacts.label ?? data.message}
        </NodeTitle>
        <NodeDescription>Step {data.index + 1}</NodeDescription>
      </NodeHeader>

      {artifactEntries.length > 0 && (
        <NodeContent className="flex flex-col gap-2">
          {artifactEntries.map(([name, text]) => (
            <div key={name} className="flex flex-col gap-0.5">
              <p
                className={`text-[9px] font-bold uppercase tracking-widest ${ARTIFACT_COLOR[name] ?? "text-muted-foreground"}`}
              >
                {ARTIFACT_LABEL[name] ?? name}
              </p>
              <p className="text-[11px] text-foreground/70 break-all line-clamp-2 font-mono leading-relaxed">
                {text.length > 120 ? `${text.slice(0, 120)}…` : text}
              </p>
            </div>
          ))}
        </NodeContent>
      )}

      <NodeFooter>
        <p className="text-[10px] text-muted-foreground/50 tabular-nums">
          {artifactEntries.length > 0
            ? `${artifactEntries.length} artifact${artifactEntries.length > 1 ? "s" : ""}`
            : "No artifacts"}
        </p>
      </NodeFooter>
    </Node>
  );
}
