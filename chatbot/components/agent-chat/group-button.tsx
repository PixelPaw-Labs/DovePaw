"use client";

import Link from "next/link";
import { Settings, Users2 } from "lucide-react";
import type { AgentGroup } from "@@/lib/agent-links-schemas";
import { cn } from "@/lib/utils";
import { useAgentRunState } from "@/components/hooks/use-agent-run-state";
import { useButtonShimmer } from "@/components/hooks/use-button-shimmer";

export function GroupButton({
  group,
  isActive,
  onClick,
  settingsHref,
  isGroupSettings,
}: {
  group: AgentGroup;
  isActive: boolean;
  onClick: () => void;
  settingsHref?: string;
  isGroupSettings?: boolean;
}) {
  const { isRunning } = useAgentRunState(isActive, undefined);
  const shimmerRef = useButtonShimmer(isRunning);
  const isSelected = isActive || isRunning;

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden my-0.5 px-4 py-2.5 flex items-center gap-3 text-left transition-all w-full",
        isSelected
          ? "bg-primary/10 text-primary border-l-4 border-primary"
          : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
      )}
    >
      {isRunning && (
        <span
          ref={shimmerRef}
          aria-hidden
          className="absolute inset-y-0 left-0 w-1/2 pointer-events-none -skew-x-12"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0.06) 75%, transparent 100%)",
          }}
        />
      )}
      <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-primary/10">
        <Users2 className="w-3 h-3 text-primary" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className={cn("text-xs font-medium truncate", !isActive && "text-foreground/80")}>
          {group.name}
        </span>
        <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide">
          {group.members.length} agents
        </span>
      </div>
      {settingsHref && (
        <Link
          href={settingsHref}
          onClick={(e) => e.stopPropagation()}
          title={`${group.name} settings`}
          className={cn(
            "shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors relative z-10",
            isGroupSettings
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50",
          )}
        >
          <Settings className="w-3 h-3" />
        </Link>
      )}
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-green-500 dark:bg-green-400 animate-pulse" />
    </button>
  );
}
