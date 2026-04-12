"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Network, Package, PawPrint, Settings, Trash2 } from "lucide-react";
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
  onClearAllHistory?: () => void;
}

export function AgentSidebar({
  agentConfigs,
  activeAgentId = "dove",
  onSelectAgent,
  onClearAllHistory,
}: AgentSidebarProps) {
  const { doveIsRunning } = useConversationContext();
  const agents = agentConfigs.map(buildAgentDef);
  const statuses = useAgentHeartbeat();
  const pathname = usePathname();
  const isSettings = pathname === "/settings";
  const isPlugins = pathname === "/settings/plugins";
  const isAgentLinks = pathname === "/settings/agent-links";

  const hasData = Object.keys(statuses).length > 0;
  const onlineCount = Object.values(statuses).filter((s) => s.online).length;
  const anyOnline = onlineCount > 0;

  const isDoveLoading = doveIsRunning;
  const doveShimmerRef = useButtonShimmer(isDoveLoading);
  // Keep the selected theme while Dove is running so switching away doesn't drop to unselected style.
  const isDoveSelected = (activeAgentId === "dove" && !isSettings) || isDoveLoading;

  const [confirming, setConfirming] = React.useState(false);
  const confirmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClearAllClick = () => {
    if (confirming) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirming(false);
      onClearAllHistory?.();
    } else {
      setConfirming(true);
      confirmTimerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  };

  React.useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

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
            isDoveSelected
              ? "bg-primary/10 text-primary border-l-4 border-primary"
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
                  "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0.06) 75%, transparent 100%)",
              }}
            />
          )}
          <Bot className={cn("w-4 h-4 shrink-0", isDoveSelected ? "text-primary" : "")} />
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className={cn("text-sm font-medium", !isDoveSelected && "text-foreground/80")}>
              Dove
            </span>
            <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide">
              Orchestrator
            </span>
          </div>
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", "bg-green-500 animate-pulse")} />
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
        {onClearAllHistory && (
          <button
            onClick={handleClearAllClick}
            className={cn(
              "my-0.5 px-4 py-2.5 flex items-center gap-3 transition-all w-full",
              confirming
                ? "text-destructive bg-destructive/10"
                : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
            )}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span className="text-sm font-medium text-foreground/80">
              {confirming ? "Confirm clear all?" : "Clear all history"}
            </span>
          </button>
        )}
        <Link
          href="/settings/agent-links"
          className={cn(
            "my-0.5 px-4 py-2.5 flex items-center gap-3 transition-all w-full",
            isAgentLinks
              ? "bg-primary/10 text-primary border-l-4 border-primary"
              : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
          )}
        >
          <Network className={cn("w-4 h-4 shrink-0", isAgentLinks ? "text-primary" : "")} />
          <span className={cn("text-sm font-medium", !isAgentLinks && "text-foreground/80")}>
            Agent Links
          </span>
        </Link>
        <Link
          href="/settings/plugins"
          className={cn(
            "my-0.5 px-4 py-2.5 flex items-center gap-3 transition-all w-full",
            isPlugins
              ? "bg-primary/10 text-primary border-l-4 border-primary"
              : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
          )}
        >
          <Package className={cn("w-4 h-4 shrink-0", isPlugins ? "text-primary" : "")} />
          <span className={cn("text-sm font-medium", !isPlugins && "text-foreground/80")}>
            Plugins
          </span>
        </Link>
        <Link
          href="/settings"
          className={cn(
            "my-0.5 px-4 py-2.5 flex items-center gap-3 transition-all w-full",
            isSettings
              ? "bg-primary/10 text-primary border-l-4 border-primary"
              : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
          )}
        >
          <Settings className={cn("w-4 h-4 shrink-0", isSettings ? "text-primary" : "")} />
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
