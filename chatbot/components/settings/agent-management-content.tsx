"use client";

import * as React from "react";
import type { AgentDef } from "@@/lib/agents";
import { z } from "zod";

const agentLaunchdStatusSchema = z.object({
  plistExists: z.boolean(),
  loaded: z.boolean(),
  plistPath: z.string(),
});
const actionErrorSchema = z.object({ error: z.string().optional() });

interface AgentLaunchdStatus {
  plistExists: boolean;
  loaded: boolean;
  plistPath: string;
}

type AllAgentsStatus = Record<string, AgentLaunchdStatus>;
type Action = "install" | "load" | "unload" | "delete";

async function callAction(agentName: string, action: Action): Promise<AgentLaunchdStatus> {
  const res = await fetch("/api/settings/launchd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentName, action }),
  });
  if (!res.ok) {
    const data = actionErrorSchema.parse(await res.json());
    throw new Error(data.error ?? "Action failed");
  }
  return agentLaunchdStatusSchema.parse(await res.json());
}

interface AgentManagementContentProps {
  agents: AgentDef[];
}

export function AgentManagementContent({ agents }: AgentManagementContentProps) {
  const [statuses, setStatuses] = React.useState<AllAgentsStatus | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null); // agentName currently acting
  const [installingAll, setInstallingAll] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/settings/launchd")
      .then((r) => r.json())
      .then((data: { agents: AllAgentsStatus }) => setStatuses(data.agents))
      .catch(() => setError("Failed to load agent statuses"));
  }, []);

  async function handleAction(agentName: string, action: Action) {
    setBusy(agentName);
    setError(null);
    try {
      const updated = await callAction(agentName, action);
      setStatuses((prev) => ({ ...prev, [agentName]: updated }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleInstallAll() {
    setInstallingAll(true);
    setError(null);
    try {
      for (const agent of agents) {
        setBusy(agent.name);
        // eslint-disable-next-line no-await-in-loop -- sequential install required; launchd plist ordering matters
        const updated = await callAction(agent.name, "install");
        setStatuses((prev) => ({ ...prev, [agent.name]: updated }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install all failed");
    } finally {
      setBusy(null);
      setInstallingAll(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Section header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-on-surface tracking-tight">
            Scheduled Agents Management
          </h2>
          <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
            Install and manage agents as launchd daemons. Each agent runs on its own schedule —
            enable or disable them individually, or install all at once.
          </p>
        </div>
        <button
          type="button"
          disabled={installingAll || busy !== null}
          onClick={() => void handleInstallAll()}
          className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {installingAll ? `Scheduling ${busy ?? ""}…` : "Schedule All Agents"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Card grid — 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            status={statuses?.[agent.name] ?? null}
            isBusy={busy === agent.name}
            onAction={(action) => void handleAction(agent.name, action)}
          />
        ))}
      </div>
    </div>
  );
}

interface AgentCardProps {
  agent: AgentDef;
  status: AgentLaunchdStatus | null;
  isBusy: boolean;
  onAction: (action: Action) => void;
}

function AgentCard({ agent, status, isBusy, onAction }: AgentCardProps) {
  const Icon = agent.icon;
  const loaded = status?.loaded ?? false;
  const plistExists = status?.plistExists ?? false;

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_16px_-4px_rgba(43,52,55,0.08)] flex flex-col gap-4 p-6 transition-all">
      {/* Card header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-on-surface text-sm leading-tight">{agent.displayName}</h3>
            <p className="text-xs text-on-surface-variant mt-0.5">{agent.scheduleDisplay}</p>
          </div>
        </div>

        {/* Toggle: load ↔ unload */}
        <label className="inline-flex items-center cursor-pointer shrink-0 mt-0.5">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={loaded}
            disabled={isBusy || (!loaded && !plistExists)}
            onChange={() => onAction(loaded ? "unload" : "load")}
            aria-label={loaded ? `Unload ${agent.displayName}` : `Load ${agent.displayName}`}
          />
          <div className="relative w-10 h-5 rounded-full transition-colors duration-200 bg-slate-300 peer-checked:bg-primary peer-disabled:opacity-40 after:absolute after:content-[''] after:top-[2px] after:left-[2px] after:w-4 after:h-4 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:duration-200 peer-checked:after:translate-x-5" />
        </label>
      </div>

      {/* Status badge */}
      <StatusBadge loaded={loaded} plistExists={plistExists} loading={status === null} />

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t border-outline-variant/20">
        {status === null ? (
          <span className="text-xs text-on-surface-variant opacity-60">Loading…</span>
        ) : loaded ? (
          <>
            <ActionBtn
              label="Unload"
              variant="secondary"
              disabled={isBusy}
              onClick={() => onAction("unload")}
            />
            <ActionBtn
              label="Re-install & Run"
              variant="primary"
              disabled={isBusy}
              onClick={() => onAction("install")}
            />
            <ActionBtn
              label="Remove"
              variant="danger"
              disabled={isBusy}
              onClick={() => onAction("delete")}
            />
          </>
        ) : plistExists ? (
          <>
            <ActionBtn
              label="Load"
              variant="primary"
              disabled={isBusy}
              onClick={() => onAction("load")}
            />
            <ActionBtn
              label="Remove"
              variant="danger"
              disabled={isBusy}
              onClick={() => onAction("delete")}
            />
          </>
        ) : (
          <ActionBtn
            label="Install"
            variant="primary"
            disabled={isBusy}
            onClick={() => onAction("install")}
          />
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  loaded,
  plistExists,
  loading,
}: {
  loaded: boolean;
  plistExists: boolean;
  loading: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-70">
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        Checking…
      </span>
    );
  }
  if (loaded) {
    // No success token in the design system — use accent (primary-container) which is the
    // nearest "positive" tone in the Material Design 3 palette (#cce6fb / on-primary-container)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-accent-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-foreground" />
        Active &amp; Running
      </span>
    );
  }
  if (plistExists) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
        <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
        Installed, Not Running
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
      Automated Scheduling
    </span>
  );
}

function ActionBtn({
  label,
  variant,
  disabled,
  onClick,
}: {
  label: string;
  variant: "primary" | "secondary" | "danger";
  disabled: boolean;
  onClick: () => void;
}) {
  const styles = {
    primary: "bg-primary text-primary-foreground hover:brightness-110",
    secondary: "bg-secondary border border-border text-foreground hover:brightness-95",
    danger:
      "bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20",
  };
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-all disabled:opacity-40 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      {label}
    </button>
  );
}
