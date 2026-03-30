import { diffLines } from "diff";
import { FileEdit, Terminal, FileText, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageAction, MessageActions } from "@/components/ai-elements/message";
import { Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { ShimmerLabel } from "./shimmer-label";
import type { ToolCall } from "@/components/hooks/use-messages";

function shortPath(p: unknown): string {
  if (typeof p !== "string") return String(p);
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}

function toolMeta(tool: ToolCall): {
  icon: React.ReactNode;
  label: string;
  detail: string;
  tooltip: string;
} {
  const { name, input } = tool;

  switch (name) {
    case "Edit":
      return {
        icon: <FileEdit className="w-3 h-3" />,
        label: "Edit",
        detail: shortPath(input.file_path),
        tooltip: typeof input.file_path === "string" ? input.file_path : "",
      };
    case "Write":
      return {
        icon: <FileText className="w-3 h-3" />,
        label: "Write",
        detail: shortPath(input.file_path),
        tooltip: typeof input.file_path === "string" ? input.file_path : "",
      };
    case "Read":
      return {
        icon: <FileText className="w-3 h-3" />,
        label: "Read",
        detail: shortPath(input.file_path),
        tooltip: typeof input.file_path === "string" ? input.file_path : "",
      };
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      return {
        icon: <Terminal className="w-3 h-3" />,
        label: "Bash",
        detail: cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd,
        tooltip: cmd,
      };
    }
    case "Grep":
    case "Glob": {
      const patternVal = input.pattern ?? input.query;
      const pattern = typeof patternVal === "string" ? patternVal : "";
      return {
        icon: <Search className="w-3 h-3" />,
        label: name,
        detail: pattern.length > 80 ? pattern.slice(0, 80) + "…" : pattern,
        tooltip: pattern,
      };
    }
    default: {
      const first = Object.values(input).find((v) => typeof v === "string") ?? "";
      const str = String(first);
      return {
        icon: <Wrench className="w-3 h-3" />,
        label: name,
        detail: str.length > 80 ? str.slice(0, 80) + "…" : str,
        tooltip: str,
      };
    }
  }
}

function DiffBlock({
  filePath,
  oldStr,
  newStr,
}: {
  filePath: string;
  oldStr: string;
  newStr: string;
}) {
  const lines = diffLines(oldStr, newStr).flatMap((hunk) =>
    hunk.value
      .replace(/\n$/, "")
      .split("\n")
      .map((content) => ({
        content,
        type: hunk.added ? "added" : hunk.removed ? "removed" : "context",
      })),
  );

  return (
    <div className="rounded-md border border-border overflow-hidden text-xs font-mono">
      <div className="px-3 py-1.5 bg-muted border-b border-border text-muted-foreground truncate">
        {filePath}
      </div>
      <pre className="overflow-x-auto bg-background p-0 m-0">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "px-3 whitespace-pre",
              line.type === "added" && "bg-green-50 text-green-800",
              line.type === "removed" && "bg-red-50 text-red-800",
              line.type === "context" && "text-foreground/70",
            )}
          >
            <span className="select-none mr-2 opacity-60">
              {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
            </span>
            {line.content}
          </div>
        ))}
      </pre>
    </div>
  );
}

export function EditDiffList({ toolCalls }: { toolCalls: ToolCall[] }) {
  const edits = toolCalls.filter(
    (t) =>
      t.name === "Edit" && t.input.old_string !== undefined && t.input.new_string !== undefined,
  );
  if (edits.length === 0) return null;

  return (
    <Sources>
      <SourcesTrigger count={edits.length}>
        <FileEdit className="h-4 w-4" />
        <p className="font-medium">
          {edits.length} file{edits.length > 1 ? "s" : ""} edited
        </p>
        <span className="text-muted-foreground text-xs">
          {edits
            .slice(0, 3)
            .map((t) => shortPath(t.input.file_path))
            .join(", ")}
          {edits.length > 3 ? `, …+${edits.length - 3}` : ""}
        </span>
      </SourcesTrigger>
      <SourcesContent>
        {edits.map((t, i) => (
          <DiffBlock
            key={i}
            filePath={typeof t.input.file_path === "string" ? t.input.file_path : ""}
            oldStr={typeof t.input.old_string === "string" ? t.input.old_string : ""}
            newStr={typeof t.input.new_string === "string" ? t.input.new_string : ""}
          />
        ))}
      </SourcesContent>
    </Sources>
  );
}

export function ToolCallList({
  toolCalls,
  isActive = false,
}: {
  toolCalls: ToolCall[];
  isActive?: boolean;
}) {
  return (
    <MessageActions className="flex-wrap">
      {toolCalls.map((tool, i) => {
        const { icon, label, detail, tooltip } = toolMeta(tool);
        return (
          <MessageAction
            key={i}
            tooltip={tooltip || label}
            variant="outline"
            size="sm"
            className="font-mono text-xs h-7 px-2 gap-1.5 cursor-default"
          >
            {icon}
            <ShimmerLabel isActive={isActive} className="truncate max-w-[400px]">
              {detail ? `${label} · ${detail}` : label}
            </ShimmerLabel>
          </MessageAction>
        );
      })}
    </MessageActions>
  );
}
