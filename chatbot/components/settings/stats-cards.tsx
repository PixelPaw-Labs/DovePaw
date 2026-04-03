import * as React from "react";
import { FolderGit2, Bot, Wifi, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentStatus } from "@/a2a/heartbeat-types";

interface StatsCardsProps {
  repoCount: number;
  agentCount: number;
  statuses: Record<string, AgentStatus>;
}

interface StatCard {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: boolean;
}

export function StatsCards({ repoCount, agentCount, statuses }: StatsCardsProps) {
  const hasData = Object.keys(statuses).length > 0;
  const onlineCount = Object.values(statuses).filter((s) => s.online).length;
  const totalAgents = agentCount;
  const isOptimal = hasData && onlineCount > 0;

  const cards: StatCard[] = [
    {
      label: "Watched Repositories",
      value: repoCount,
      sub: repoCount === 1 ? "repository" : "repositories",
      icon: FolderGit2,
    },
    {
      label: "Total Agents",
      value: totalAgents,
      sub: "configured",
      icon: Bot,
    },
    {
      label: "Agents Online",
      value: hasData ? onlineCount : "—",
      sub: hasData ? `of ${totalAgents}` : "connecting…",
      icon: Wifi,
    },
    {
      label: "System Status",
      value: !hasData ? "Connecting" : isOptimal ? "Optimal" : "Offline",
      sub: !hasData
        ? "waiting for agents"
        : isOptimal
          ? `${onlineCount} agent${onlineCount !== 1 ? "s" : ""} active`
          : "no agents running",
      icon: ShieldCheck,
      accent: isOptimal,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="rounded-xl bg-surface-container border border-outline-variant/30 p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                {card.label}
              </span>
              <div
                className={cn(
                  "w-8 h-8 rounded-lg flex items-center justify-center",
                  card.accent
                    ? "bg-primary text-on-primary"
                    : "bg-surface-container-high text-on-surface-variant",
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
            </div>
            <div>
              <p
                className={cn(
                  "text-3xl font-extrabold tracking-tight",
                  card.accent ? "text-primary" : "text-on-surface",
                )}
              >
                {card.value}
              </p>
              {card.sub && <p className="text-xs text-on-surface-variant mt-0.5">{card.sub}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
