"use client";

import * as React from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { createScope, animate } from "animejs";
import { HeartbeatLine } from "./heartbeat-line";
import { ShimmerLabel } from "./shimmer-label";
import type { AgentDef } from "@@/lib/agents";
import { cn } from "@/lib/utils";
import type { AgentStatus, LaunchdStatus } from "@/a2a/heartbeat-types";

function nextRunMs(schedule: AgentDef["schedule"]): number | null {
  if (!schedule) return null;
  const now = Date.now();
  if (schedule.type === "interval") {
    const ms = schedule.seconds * 1000;
    return Math.floor(now / ms) * ms + ms;
  }
  const next = new Date();
  next.setSeconds(0, 0);
  next.setHours(schedule.hour, schedule.minute);
  if (schedule.weekday !== undefined) {
    const diff = (schedule.weekday - next.getDay() + 7) % 7;
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
    if (remaining === null) return;
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
  launchd,
  processing,
  processingTrigger,
  schedule,
}: {
  launchd: LaunchdStatus | null;
  processing: boolean;
  processingTrigger: "scheduled" | "dove" | null;
  schedule: AgentDef["schedule"];
}) {
  if (processing)
    return (
      <span className="text-[9px] text-blue-500/80 uppercase tracking-wide flex items-center gap-1.5">
        <HeartbeatLine />
        processing{processingTrigger ? ` · ${processingTrigger}` : ""}
      </span>
    );

  if (!launchd)
    return <span className="text-[9px] text-muted-foreground/30 uppercase tracking-wide">—</span>;
  if (!launchd.loaded)
    return (
      <span className="text-[9px] text-muted-foreground/40 uppercase tracking-wide">unloaded</span>
    );

  const countdown = <ScheduleCountdown schedule={schedule} />;

  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide">● idle</span>
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
}: {
  agent: AgentDef;
  isActive: boolean;
  status: AgentStatus | undefined;
  hasData: boolean;
  onClick: () => void;
  settingsHref?: string;
  isAgentSettings?: boolean;
}) {
  const root = React.useRef<HTMLButtonElement>(null);
  const scope = React.useRef<ReturnType<typeof createScope> | null>(null);
  const Icon = agent.icon;
  const isOnline = status?.online ?? false;
  const isRunning = status?.processing ?? false;

  React.useEffect(() => {
    if (!isRunning) {
      scope.current?.revert();
      scope.current = null;
      return;
    }
    scope.current = createScope({ root: root.current! }).add(() => {
      animate(".shimmer-sweep", {
        translateX: ["-100%", "100%"],
        duration: 2000,
        ease: "linear",
        loop: true,
      });
    });
    return () => {
      scope.current?.revert();
      scope.current = null;
    };
  }, [isRunning]);

  return (
    <button
      ref={root}
      onClick={onClick}
      className={cn(
        "group my-0.5 px-4 py-2.5 flex items-center gap-3 text-left transition-all w-full relative overflow-hidden",
        isActive
          ? "bg-blue-100/60 text-blue-900 border-l-4 border-blue-500"
          : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
      )}
    >
      {/* Shimmer sweep — visible only when launchd is running */}
      {isRunning && (
        <div
          className="shimmer-sweep absolute top-0 left-0 h-full z-0 pointer-events-none bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"
          style={{ width: "200%" }}
        />
      )}

      <div
        className={cn(
          "w-6 h-6 rounded-md flex items-center justify-center shrink-0 relative z-10 transition-colors",
          agent.iconBg,
          agent.iconColor,
        )}
      >
        <Icon className="w-3 h-3" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 relative z-10">
        <ShimmerLabel
          isActive={isRunning}
          className={cn("text-sm font-medium", !isActive && "text-foreground/80")}
        >
          {agent.displayName}
        </ShimmerLabel>
        <LaunchdBadge
          launchd={status?.launchd ?? null}
          processing={status?.processing ?? false}
          processingTrigger={status?.processingTrigger ?? null}
          schedule={agent.schedule}
        />
      </div>
      {settingsHref && (
        <Link
          href={settingsHref}
          onClick={(e) => e.stopPropagation()}
          title={`${agent.displayName} repo settings`}
          className={cn(
            "shrink-0 w-5 h-5 rounded flex items-center justify-center transition-colors relative z-10",
            isAgentSettings
              ? "bg-blue-200/60 text-blue-700"
              : "text-muted-foreground/40 hover:text-muted-foreground hover:bg-black/5",
          )}
        >
          <Settings className="w-3 h-3" />
        </Link>
      )}
      <span
        className={cn(
          "w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-500 relative z-10",
          isActive
            ? "bg-blue-500"
            : isOnline
              ? "bg-green-500 animate-pulse"
              : !hasData
                ? "bg-muted-foreground/20"
                : "bg-red-400/60",
        )}
      />
    </button>
  );
}
