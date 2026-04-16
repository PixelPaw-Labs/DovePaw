"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bot,
  ChevronDown,
  Network,
  Package,
  PawPrint,
  Settings,
  Sparkles,
  Trash2,
  Users2,
} from "lucide-react";
import { LUCIDE_ICON_REGISTRY } from "@@/lib/icon-registry";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { AgentGroup as AgentLinkGroup } from "@@/lib/agent-links-schemas";
import { groupAgentsByPlugin, type AgentGroup } from "@@/lib/agent-groups";
import type { PluginRecord } from "@@/lib/plugin-schemas";
import { cn } from "@/lib/utils";
import { useAgentHeartbeat } from "@/components/hooks/use-agent-heartbeat";
import { useConversationContext } from "@/components/hooks/use-conversation-context";
import { useButtonShimmer } from "@/components/hooks/use-button-shimmer";
import { useDoveSettings } from "@/components/hooks/use-dove-settings";
import type { DoveSettings } from "@@/lib/settings-schemas";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { AgentStatus } from "@/a2a/heartbeat-types";
import { AgentButton } from "./agent-button";

interface AgentSidebarProps {
  agentConfigs: AgentConfigEntry[];
  tmpAgentConfigs?: AgentConfigEntry[];
  plugins?: readonly Pick<PluginRecord, "path" | "name">[];
  groups?: AgentLinkGroup[];
  activeAgentId?: string;
  initialDoveSettings?: DoveSettings;
  onSelectAgent?: (agentId: string) => void;
  onClearAllHistory?: () => void;
}

export function AgentSidebar({
  agentConfigs,
  tmpAgentConfigs = [],
  plugins = [],
  groups = [],
  activeAgentId = "dove",
  initialDoveSettings,
  onSelectAgent,
  onClearAllHistory,
}: AgentSidebarProps) {
  const { doveIsRunning } = useConversationContext();
  const statuses = useAgentHeartbeat();
  const pathname = usePathname();
  const router = useRouter();
  const isSettings = pathname === "/settings";
  const isPlugins = pathname === "/settings/plugins";
  const isAgentLinks = pathname === "/settings/agent-links";

  const hasData = Object.keys(statuses).length > 0;
  const onlineCount = Object.values(statuses).filter((s) => s.online).length;
  const anyOnline = onlineCount > 0;

  const doveSettings = useDoveSettings(initialDoveSettings);
  const DoveIcon = LUCIDE_ICON_REGISTRY[doveSettings.iconName] ?? Bot;

  const isDoveLoading = doveIsRunning;
  const doveShimmerRef = useButtonShimmer(isDoveLoading);
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

  const pluginGroups = groupAgentsByPlugin(agentConfigs, tmpAgentConfigs, plugins);
  const showHeaders = pluginGroups.some((g) => g.pluginName !== "");
  const chatGroups = groups.filter((g) => g.members.length >= 2);

  async function handleDeleteTmpAgent(agentName: string) {
    await fetch("/api/settings/agents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: agentName }),
    });
    router.refresh();
  }

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

      {/* Agent nav — scrolls independently; settings links stay pinned below */}
      <nav className="flex flex-col gap-1 flex-1 overflow-y-auto misty-scroll">
        {/* Dove — the orchestrator (always first, outside all groups) */}
        <button
          onClick={() => onSelectAgent?.("dove")}
          className={cn(
            "relative overflow-hidden shrink-0 my-0.5 px-4 py-2.5 flex items-center gap-3 text-left transition-all w-full",
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
          <div
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors",
              doveSettings.iconBg,
              doveSettings.iconColor,
            )}
          >
            <DoveIcon className="w-3 h-3" />
          </div>
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <span className={cn("text-sm font-medium", !isDoveSelected && "text-foreground/80")}>
              {doveSettings.displayName}
            </span>
            <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide">
              Orchestrator
            </span>
          </div>
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", "bg-green-500 animate-pulse")} />
        </button>

        {/* Named group chats (from agent-links.json) */}
        {chatGroups.length > 0 && (
          <div className="flex flex-col gap-0 mt-3 shrink-0">
            <div className="flex items-center gap-2 px-4 py-2 w-full text-left border-t border-border/40 bg-muted/40 shrink-0">
              <Users2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 text-[11px] uppercase tracking-widest font-bold text-muted-foreground truncate">
                Group Chats
              </span>
            </div>
            {chatGroups.map((group) => {
              const selectionId = `group:${group.name}`;
              const isActive = !isSettings && activeAgentId === selectionId;
              return (
                <button
                  key={group.name}
                  onClick={() => onSelectAgent?.(selectionId)}
                  className={cn(
                    "shrink-0 my-0.5 px-4 py-2.5 flex items-center gap-3 text-left transition-all w-full",
                    isActive
                      ? "bg-primary/10 text-primary border-l-4 border-primary"
                      : "text-muted-foreground hover:bg-muted hover:translate-x-0.5 duration-200",
                  )}
                >
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-primary/10">
                    <Users2 className="w-3 h-3 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span
                      className={cn(
                        "text-sm font-medium truncate",
                        !isActive && "text-foreground/80",
                      )}
                    >
                      {group.name}
                    </span>
                    <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wide">
                      {group.members.length} agents
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Plugin groups */}
        {pluginGroups.map((group) => (
          <PluginGroup
            key={group.pluginName || "__ungrouped__"}
            group={group}
            showHeader={showHeaders && group.pluginName !== ""}
            pathname={pathname}
            activeAgentId={activeAgentId}
            isSettings={isSettings}
            statuses={statuses}
            hasData={hasData}
            onSelectAgent={onSelectAgent}
            onDeleteTmpAgent={group.temporary ? handleDeleteTmpAgent : undefined}
          />
        ))}
      </nav>

      {/* Settings nav links — always pinned at bottom */}
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

// ─── PluginGroup ──────────────────────────────────────────────────────────────

interface PluginGroupProps {
  group: AgentGroup;
  showHeader: boolean;
  pathname: string;
  activeAgentId: string;
  isSettings: boolean;
  statuses: Record<string, AgentStatus>;
  hasData: boolean;
  onSelectAgent?: (agentId: string) => void;
  onDeleteTmpAgent?: (agentName: string) => Promise<void>;
}

function PluginGroup({
  group,
  showHeader,
  pathname,
  activeAgentId,
  isSettings,
  statuses,
  hasData,
  onSelectAgent,
  onDeleteTmpAgent,
}: PluginGroupProps) {
  const [open, setOpen] = React.useState(true);

  const GroupIcon = group.temporary ? Sparkles : Package;

  const agentButtons = group.agents.map((config) => {
    const agent = buildAgentDef(config);
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
        onDelete={onDeleteTmpAgent ? () => void onDeleteTmpAgent(agent.name) : undefined}
      />
    );
  });

  if (!showHeader) {
    return <>{agentButtons}</>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col mt-3">
      <CollapsibleTrigger className="flex items-center gap-2 px-4 py-2 w-full text-left border-t border-border/40 bg-muted/40 hover:bg-muted/70 transition-colors group">
        <GroupIcon className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[11px] uppercase tracking-widest font-bold text-muted-foreground truncate">
          {group.pluginName}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-0">{agentButtons}</CollapsibleContent>
    </Collapsible>
  );
}
