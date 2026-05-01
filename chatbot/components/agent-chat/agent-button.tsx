"use client";

import * as React from "react";
import Link from "next/link";
import { Settings, Trash2 } from "lucide-react";
import { useAgentRunState } from "@/components/hooks/use-agent-run-state";
import { useButtonShimmer } from "@/components/hooks/use-button-shimmer";
import type { AgentDef } from "@@/lib/agents";
import { cn } from "@/lib/utils";
import type { AgentStatus, SchedulerStatus } from "@/a2a/heartbeat-types";

function nextRunMs(schedule: AgentDef["schedule"]): number | null {
  if (!schedule) return null;
  const now = Date.now();
  if (schedule.type === "interval") {
    const ms = schedule.seconds * 1000;
    return Math.floor(now / ms) * ms + ms;
  }
  if (schedule.type === "onetime") return null;
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(schedule.hour, schedule.minute);
  if (schedule.weekday !== undefined) {
    // Convert JS getDay() (0=Sun) to ISO (1=Mon…7=Sun) for comparison
    const jsDay = next.getDay();
    const currentIso = jsDay === 0 ? 7 : jsDay;
    const diff = (schedule.weekday - currentIso + 7) % 7;
    next.setDate(next.getDate() + (diff === 0 && next.getTime() <= now ? 7 : diff));
  } else if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

function ScheduleCountdown({ schedule }: { schedule: AgentDef["schedule"] }) {
  const [remaining, setRemaining] = React.useState(() => {
    const t = nextRunMs(schedule);
    return t ? Math.max(0, Math.floor((t - Date.now()) / 1000)) : null;
  });

  React.useEffect(() => {
    if (remaining === null) return () => {};
    const id = setInterval(() => {
      const t = nextRunMs(schedule);
      setRemaining(t ? Math.max(0, Math.floor((t - Date.now()) / 1000)) : null);
    }, 1000);
    return () => clearInterval(id);
  }, [schedule]);

  if (remaining === null) return null;

  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  const label = `${h}h:${String(m).padStart(2, "0")}m:${String(s).padStart(2, "0")}s`;

  return <span className="text-[9px] text-muted-foreground/70 tabular-nums">{label}</span>;
}

function LaunchdBadge({
  scheduler,
  processing,
  processingTrigger,
  schedule,
}: {
  scheduler: SchedulerStatus | null;
  processing: boolean;
  processingTrigger: "scheduled" | "dove" | null;
  schedule: AgentDef["schedule"];
}) {
  if (processing)
    return (
      <span className="text-[9px] text-blue-500 font-semibold uppercase tracking-wide">
        ● processing{processingTrigger ? ` · ${processingTrigger}` : ""}
      </span>
    );

  if (!scheduler)
    return (
      <span className="text-[9px] text-muted-foreground/50 uppercase tracking-wide">
        not installed
      </span>
    );
  if (!scheduler.loaded)
    return (
      <span className="text-[9px] text-amber-500/80 font-medium uppercase tracking-wide">
        unloaded
      </span>
    );

  const countdown = <ScheduleCountdown schedule={schedule} />;

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[9px] text-emerald-500/90 font-medium uppercase tracking-wide">
        ● idle
      </span>
      {countdown}
    </span>
  );
}

export function AgentButton({
  agent,
  isActive,
  status,
  hasData,
  onClick,
  settingsHref,
  isAgentSettings,
  onDelete,
}: {
  agent: AgentDef;
  isActive: boolean;
  status: AgentStatus | undefined;
  hasData: boolean;
  onClick: () => void;
  settingsHref?: string;
  isAgentSettings?: boolean;
  onDelete?: () => void;
}) {
  const Icon = agent.icon;
  const isOnline = status?.online ?? false;
  const { isRunning, processingTrigger } = useAgentRunState(isActive, status);
  const shimmerRef = useButtonShimmer(isRunning);
  // Keep the selected theme while running so switching away doesn't drop to unselected style.
  const isSelected = isActive || isRunning;

  const [deleteConfirm, setDeleteConfirm] = React.useState(false);
  const deleteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (deleteConfirm) {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      setDeleteConfirm(false);
      onDelete?.();
    } else {
      setDeleteConfirm(true);
      deleteTimerRef.current = setTimeout(() => setDeleteConfirm(false), 3000);
    }
  }

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
      <div
        className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors",
          agent.iconBg,
          agent.iconColor,
        )}
      >
        <Icon className="w-3 h-3" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className={cn("text-xs font-medium", !isSelected && "text-foreground/80")}>
          {agent.displayName}
        </span>
        <LaunchdBadge
          scheduler={status?.scheduler ?? null}
          processing={isRunning}
          processingTrigger={processingTrigger}
          schedule={agent.schedule}
        />
      </div>
      {onDelete && (
        <span
          role="button"
          onClick={handleDeleteClick}
          title={deleteConfirm ? "Click to confirm deletion" : `Delete ${agent.displayName}`}
          className={cn(
            "shrink-0 rounded flex items-center justify-center gap-1 transition-all relative z-10",
            deleteConfirm
              ? "text-destructive bg-destructive/10 px-1.5 h-5 text-[10px] font-bold"
              : "text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 w-5 h-5",
          )}
        >
          {deleteConfirm ? <span>Confirm</span> : <Trash2 className="w-3 h-3" />}
        </span>
      )}
      {settingsHref && (
        <Link
          href={settingsHref}
          onClick={(e) => e.stopPropagation()}
          title={`${agent.displayName} repo settings`}
          className={cn(
            "shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors relative z-10",
            isAgentSettings
              ? "bg-primary/20 text-primary"
              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-black/5",
          )}
        >
          <Settings className="w-3 h-3" />
        </Link>
      )}
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500",
          isOnline
            ? "bg-green-500 animate-pulse"
            : !hasData
              ? "bg-muted-foreground/20"
              : "bg-red-400/60",
        )}
      />
    </button>
  );
}
