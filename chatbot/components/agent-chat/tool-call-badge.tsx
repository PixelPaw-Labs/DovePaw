import { diffLines } from "diff";
import { FileEdit } from "lucide-react";
import type { BundledLanguage } from "shiki";
import { cn } from "@/lib/utils";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block";
import { Sources, SourcesContent, SourcesTrigger } from "@/components/ai-elements/sources";
import { Tool, ToolContent, ToolHeader, ToolInput } from "@/components/ai-elements/tool";
import type { DynamicToolUIPart } from "ai";
import type { ToolCall } from "@/components/hooks/use-messages";

function shortPath(p: unknown): string {
  if (typeof p !== "string") return String(p);
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : parts.join("/");
}

function toolDetail(tool: ToolCall): string {
  const { name, input } = tool;
  switch (name) {
    case "Edit":
    case "Write":
    case "Read":
      return shortPath(input.file_path);
    case "Bash": {
      const cmd = typeof input.command === "string" ? input.command : "";
      return cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd;
    }
    case "Grep":
    case "Glob": {
      const pat = input.pattern ?? input.query;
      const str = typeof pat === "string" ? pat : "";
      return str.length > 60 ? str.slice(0, 60) + "…" : str;
    }
    default: {
      const first = Object.values(input).find((v) => typeof v === "string") ?? "";
      return first.length > 60 ? first.slice(0, 60) + "…" : first;
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
    <div className="group relative w-full overflow-hidden rounded-md border bg-background text-foreground text-xs font-mono">
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename>{filePath}</CodeBlockFilename>
        </CodeBlockTitle>
      </CodeBlockHeader>
      <pre className="overflow-x-auto p-0 m-0">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "px-3 whitespace-pre",
              line.type === "added" &&
                "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-400",
              line.type === "removed" &&
                "bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-400",
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

export function EditDiff({ tool }: { tool: ToolCall }) {
  if (
    tool.name !== "Edit" ||
    tool.input.old_string === undefined ||
    tool.input.new_string === undefined
  )
    return null;
  return (
    <DiffBlock
      filePath={typeof tool.input.file_path === "string" ? tool.input.file_path : ""}
      oldStr={typeof tool.input.old_string === "string" ? tool.input.old_string : ""}
      newStr={typeof tool.input.new_string === "string" ? tool.input.new_string : ""}
    />
  );
}

const EXT_LANG: Partial<Record<string, BundledLanguage>> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  css: "css",
  html: "html",
  sh: "bash",
};

function extLang(filePath: string): BundledLanguage {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "markdown";
}

export function WriteDiff({ tool }: { tool: ToolCall }) {
  if (
    tool.name !== "Write" ||
    typeof tool.input.file_path !== "string" ||
    typeof tool.input.content !== "string"
  )
    return null;
  const filePath = tool.input.file_path;
  return (
    <CodeBlock code={tool.input.content} language={extLang(filePath)}>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <CodeBlockFilename>{shortPath(filePath)}</CodeBlockFilename>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
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

export function ToolCallItem({ tool, isActive = false }: { tool: ToolCall; isActive?: boolean }) {
  const detail = toolDetail(tool);
  const state: DynamicToolUIPart["state"] = isActive ? "input-available" : "output-available";

  return (
    <Tool>
      <ToolHeader
        type="dynamic-tool"
        toolName={tool.name}
        title={detail ? `${tool.name} · ${detail}` : tool.name}
        state={state}
      />
      <ToolContent>
        <ToolInput input={tool.input} />
      </ToolContent>
    </Tool>
  );
}
