"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PawPrint, Settings } from "lucide-react";
import { AGENTS } from "@@/lib/agents";
import { cn } from "@/lib/utils";
import { WS_PORT } from "@/a2a/heartbeat-types";
import type { AgentStatus, StatusMessage } from "@/a2a/heartbeat-types";
import { AgentButton } from "./agent-button";

const WS_URL = `ws://127.0.0.1:${WS_PORT}`;
const RECONNECT_DELAY_MS = 3_000;

function useAgentStatuses() {
  const [statuses, setStatuses] = React.useState<Record<string, AgentStatus>>({});

  React.useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.addEventListener("message", (event) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON.parse from known WebSocket source
          const msg = JSON.parse(event.data as string) as StatusMessage;
          if (msg.type === "status") setStatuses(msg.agents);
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener("close", () => {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });

      ws.addEventListener("error", () => {
        ws?.close();
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return statuses;
}

export function AgentSidebar() {
  const statuses = useAgentStatuses();
  const [activeIndex, setActiveIndex] = React.useState(0);
  const pathname = usePathname();
  const isSettings = pathname === "/settings";

  const hasData = Object.keys(statuses).length > 0;
  const onlineCount = Object.values(statuses).filter((s) => s.online).length;
  const anyOnline = onlineCount > 0;

  return (
    <aside className="h-screen w-72 shrink-0 flex flex-col bg-background border-r border-border/30">
      {/* Logo header */}
      <div className="px-6 py-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
            <PawPrint className="w-5 h-5" />
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
      <nav className="flex flex-col gap-1 flex-1 overflow-y-auto misty-scroll px-2">
        {AGENTS.map((agent, i) => {
          const isAgentSettings =
            pathname === `/settings/agents/${agent.name}` ||
            pathname === `/settings/agents/${agent.name}/repos`;
          return (
            <AgentButton
              key={agent.manifestKey}
              agent={agent}
              isActive={!isSettings && !isAgentSettings && i === activeIndex}
              status={statuses[agent.manifestKey]}
              hasData={hasData}
              onClick={() => setActiveIndex(i)}
              settingsHref={`/settings/agents/${agent.name}`}
              isAgentSettings={isAgentSettings}
            />
          );
        })}
      </nav>

      {/* Settings nav link */}
      <div className="px-2 pb-2">
        <Link
          href="/settings"
          className={cn(
            "mx-2 my-0.5 rounded-lg px-4 py-2.5 flex items-center gap-3 transition-all w-[calc(100%-1rem)]",
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
      <div className="p-6">
        <div className="p-4 rounded-xl bg-muted border border-border/40">
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
