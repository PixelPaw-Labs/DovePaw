"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, PawPrint, Settings } from "lucide-react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { cn } from "@/lib/utils";
import { useAgentHeartbeat } from "@/components/hooks/use-agent-heartbeat";
import { useConversationContext } from "@/components/hooks/use-conversation-context";
import { useButtonShimmer } from "@/components/hooks/use-button-shimmer";
import { AgentButton } from "./agent-button";

interface AgentSidebarProps {
  agentConfigs: AgentConfigEntry[];
  activeAgentId?: string;
  onSelectAgent?: (agentId: string) => void;
}

export function AgentSidebar({
  agentConfigs,
  activeAgentId = "dove",
  onSelectAgent,
}: AgentSidebarProps) {
  const { doveIsRunning } = useConversationContext();
  const agents = agentConfigs.map(buildAgentDef);
  const statuses = useAgentHeartbeat();
  const pathname = usePathname();
  const isSettings = pathname === "/settings";

  const hasData = Object.keys(statuses).length > 0;
  const onlineCount = Object.values(statuses).filter((s) => s.online).length;
  const anyOnline = onlineCount > 0;

  const isDoveLoading = doveIsRunning;
  const doveShimmerRef = useButtonShimmer(isDoveLoading);

  return (
    <aside className="h-screen w-64 shrink-0 flex flex-col bg-background border-r border-border/30">
      {/* Logo header */}
      <div className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
            <PawPrint className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs uppercase tracking-[0.2em] font-bold text-muted-foreground">
              DOVEPAW AGENTS
            </h2>
            <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              AI Workforce
            </p>
          </div>
        </div>
      </div>

      {/* Agent nav */}
      <nav className="flex flex-col gap-1 flex-1 overflow-y-auto misty-scroll">
        {/* Dove — the orchestrator (always first) */}
        <button
          onClick={() => onSelectAgent?.("dove")}
          className={cn(
            "relative overflow-hidden my-0.5 px-4 py-2.5 flex items-center gap-3 text-left transition-all w-full",
            activeAgentId === "dove" && !isSettings
              ? "bg-blue-100/60 text-blue-900 border-l-4 border-blue-500"
              : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
          )}
        >
          {isDoveLoading && (
            <span
              ref={doveShimmerRef}
              aria-hidden
              className="absolute inset-y-0 left-0 w-1/2 pointer-events-none -skew-x-12"
              style={{
                background:
                  activeAgentId === "dove" && !isSettings
                    ? // selected (blue bg): soft white glow
                      "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.48) 50%, rgba(255,255,255,0.04) 75%, transparent 100%)"
                    : // unselected (near-white bg): soft blue glow
                      "linear-gradient(90deg, transparent 0%, rgba(96,165,250,0.04) 25%, rgba(96,165,250,0.42) 50%, rgba(96,165,250,0.04) 75%, transparent 100%)",
              }}
            />
          )}
          <Bot
            className={cn(
              "w-4 h-4 shrink-0",
              activeAgentId === "dove" && !isSettings ? "text-blue-700" : "",
            )}
          />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span
              className={cn(
                "text-sm font-medium",
                activeAgentId !== "dove" && "text-foreground/80",
              )}
            >
              Dove
            </span>
            <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide">
              Orchestrator
            </span>
          </div>
          <span
            className={cn(
              "w-1.5 h-1.5 rounded-full shrink-0",
              activeAgentId === "dove" && !isSettings
                ? "bg-blue-500"
                : "bg-green-500 animate-pulse",
            )}
          />
        </button>

        {agents.map((agent) => {
          const isAgentSettings =
            pathname === `/settings/agents/${agent.name}` ||
            pathname === `/settings/agents/${agent.name}/repos`;
          return (
            <AgentButton
              key={agent.manifestKey}
              agent={agent}
              isActive={!isSettings && !isAgentSettings && activeAgentId === agent.name}
              status={statuses[agent.manifestKey]}
              hasData={hasData}
              onClick={() => onSelectAgent?.(agent.name)}
              settingsHref={`/settings/agents/${agent.name}`}
              isAgentSettings={isAgentSettings}
            />
          );
        })}
      </nav>

      {/* Settings nav links */}
      <div className="pb-2 flex flex-col gap-0.5">
        <Link
          href="/settings"
          className={cn(
            "my-0.5 px-4 py-2.5 flex items-center gap-3 transition-all w-full",
            isSettings
              ? "bg-blue-100/60 text-blue-900 border-l-4 border-blue-500"
              : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
          )}
        >
          <Settings className={cn("w-4 h-4 shrink-0", isSettings ? "text-blue-700" : "")} />
          <span className={cn("text-sm font-medium", !isSettings && "text-foreground/80")}>
            Settings
          </span>
        </Link>
      </div>

      {/* Bottom branding */}
      <div className="p-4">
        <div className="p-3 rounded-xl bg-muted border border-border/40">
          <p className="text-[11px] font-bold text-primary tracking-tight mb-1">DovePaw</p>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full shrink-0",
                anyOnline ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40",
              )}
            />
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {!hasData
                ? "Connecting…"
                : anyOnline
                  ? `System Status: Optimal · ${onlineCount} active`
                  : "Agents Offline"}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
