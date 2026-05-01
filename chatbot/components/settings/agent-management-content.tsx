"use client";

import * as React from "react";
import { ChevronDown, Package } from "lucide-react";
import type { AgentDef } from "@@/lib/agents";
import { agentScheduleSchema, formatScheduleDisplay } from "@@/lib/agents-config-schemas";
import { resolvePluginName } from "@@/lib/agent-groups";
import type { PluginRecord } from "@@/lib/plugin-schemas";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { z } from "zod";

const jobStatusSchema = z.object({
  plistExists: z.boolean(),
  loaded: z.boolean(),
  plistPath: z.string(),
  plistLabel: z.string().optional(),
  label: z.string().optional(),
  instruction: z.string(),
  schedule: agentScheduleSchema.optional(),
});

const agentJobsSchema = z.object({
  jobs: z.record(z.string(), jobStatusSchema),
});

const actionErrorSchema = z.object({ error: z.string().optional() });

type JobStatus = z.infer<typeof jobStatusSchema>;
type AgentJobStatuses = z.infer<typeof agentJobsSchema>;
type AllAgentsStatus = Record<string, AgentJobStatuses>;
type Action = "install" | "load" | "unload" | "delete";

async function callAction(
  agentName: string,
  action: Action,
  jobId?: string,
): Promise<AgentJobStatuses> {
  const res = await fetch("/api/settings/launchd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentName, action, jobId }),
  });
  if (!res.ok) {
    const data = actionErrorSchema.parse(await res.json());
    throw new Error(data.error ?? "Action failed");
  }
  return agentJobsSchema.parse(await res.json());
}

function busyKey(agentName: string, jobId?: string) {
  return jobId ? `${agentName}.${jobId}` : agentName;
}

interface AgentDefGroup {
  pluginName: string;
  pluginPath?: string;
  agents: AgentDef[];
}

function groupAgentDefs(
  agents: AgentDef[],
  plugins: readonly Pick<PluginRecord, "path" | "name">[] = [],
): AgentDefGroup[] {
  const ungrouped: AgentDef[] = [];
  const byPlugin = new Map<string, AgentDef[]>();
  for (const agent of agents) {
    if (!agent.pluginPath) {
      ungrouped.push(agent);
    } else {
      if (!byPlugin.has(agent.pluginPath)) byPlugin.set(agent.pluginPath, []);
      byPlugin.get(agent.pluginPath)!.push(agent);
    }
  }
  const result: AgentDefGroup[] = [];
  if (ungrouped.length > 0) result.push({ pluginName: "", agents: ungrouped });
  for (const [pluginPath, pluginAgents] of byPlugin) {
    result.push({
      pluginName: resolvePluginName(pluginPath, plugins),
      pluginPath,
      agents: pluginAgents,
    });
  }
  return result;
}

interface AgentManagementContentProps {
  agents: AgentDef[];
  plugins?: readonly Pick<PluginRecord, "path" | "name">[];
}

export function AgentManagementContent({ agents, plugins = [] }: AgentManagementContentProps) {
  const [statuses, setStatuses] = React.useState<AllAgentsStatus | null>(null);
  const [busy, setBusy] = React.useState<Set<string>>(new Set());
  const [installingAll, setInstallingAll] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch("/api/settings/launchd")
      .then((r) => r.json())
      .then((data: { agents: AllAgentsStatus }) => setStatuses(data.agents))
      .catch(() => setError("Failed to load agent statuses"));
  }, []);

  async function handleAction(agentName: string, action: Action, jobId?: string) {
    const key = busyKey(agentName, jobId);
    setBusy((prev) => new Set(prev).add(key));
    setError(null);
    try {
      const updated = await callAction(agentName, action, jobId);
      setStatuses((prev) => ({ ...prev, [agentName]: updated }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function handleInstallAll() {
    setInstallingAll(true);
    setError(null);
    try {
      for (const agent of agents) {
        const key = busyKey(agent.name);
        setBusy((prev) => new Set(prev).add(key));
        // eslint-disable-next-line no-await-in-loop -- sequential install required; launchd plist ordering matters
        const updated = await callAction(agent.name, "install");
        setStatuses((prev) => ({ ...prev, [agent.name]: updated }));
        setBusy((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Install all failed");
    } finally {
      setBusy(new Set());
      setInstallingAll(false);
    }
  }

  const anyBusy = busy.size > 0;

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
          disabled={installingAll || anyBusy}
          onClick={() => void handleInstallAll()}
          className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-bold bg-primary text-primary-foreground transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {installingAll ? "Scheduling…" : "Schedule All Agents"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Cards grouped by plugin */}
      {groupAgentDefs(agents, plugins).map((group) => (
        <PluginSection
          key={group.pluginName || "__ungrouped__"}
          group={group}
          statuses={statuses}
          busy={busy}
          onAction={handleAction}
        />
      ))}
    </div>
  );
}

// ─── PluginSection ────────────────────────────────────────────────────────────

interface PluginSectionProps {
  group: AgentDefGroup;
  statuses: AllAgentsStatus | null;
  busy: Set<string>;
  onAction: (agentName: string, action: Action, jobId?: string) => void;
}

function PluginSection({ group, statuses, busy, onAction }: PluginSectionProps) {
  const [open, setOpen] = React.useState(true);

  const cards = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {group.agents.map((agent) => (
        <AgentCard
          key={agent.name}
          agent={agent}
          agentStatus={statuses?.[agent.name] ?? null}
          busy={busy}
          onAction={(action, jobId) => onAction(agent.name, action, jobId)}
        />
      ))}
    </div>
  );

  if (!group.pluginName) return cards;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 mb-3 group w-full text-left">
        <Package className="w-4 h-4 text-muted-foreground/60 shrink-0" />
        <span className="text-sm font-semibold text-muted-foreground flex-1">
          {group.pluginName}
        </span>
        <span className="text-[10px] text-muted-foreground/50 font-mono">
          {group.agents.length} agent{group.agents.length !== 1 ? "s" : ""}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 text-muted-foreground/40 transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>{cards}</CollapsibleContent>
    </Collapsible>
  );
}

// ─── AgentCard ────────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: AgentDef;
  agentStatus: AgentJobStatuses | null;
  busy: Set<string>;
  onAction: (action: Action, jobId?: string) => void;
}

function AgentCard({ agent, agentStatus, busy, onAction }: AgentCardProps) {
  const Icon = agent.icon;
  const jobs = agentStatus ? Object.entries(agentStatus.jobs) : null;
  const anyLoaded = jobs?.some(([, j]) => j.loaded) ?? false;
  const agentBusy = Array.from(busy).some(
    (k) => k === agent.name || k.startsWith(`${agent.name}.`),
  );

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_16px_-4px_rgba(43,52,55,0.08)] flex flex-col gap-4 p-6 transition-all">
      {/* Card header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${agent.iconBg} ${agent.iconColor}`}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-on-surface text-sm leading-tight">{agent.displayName}</h3>
          </div>
        </div>

        {/* Agent-level install button */}
        <ActionBtn
          label="Install All"
          variant="primary"
          disabled={agentBusy}
          onClick={() => onAction("install")}
        />
      </div>

      {/* Per-job rows */}
      {jobs === null ? (
        <span className="text-xs text-on-surface-variant opacity-60">Loading…</span>
      ) : jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No scheduled jobs — add one in agent settings.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {jobs.map(([jobId, jobStatus]) => (
            <JobRow
              key={jobId}
              jobId={jobId}
              jobStatus={jobStatus}
              isBusy={busy.has(`${agent.name}.${jobId}`)}
              agentBusy={agentBusy}
              onAction={(action) => onAction(action, jobId)}
            />
          ))}
        </div>
      )}

      {/* Agent-level status summary */}
      {jobs !== null && (
        <div className="pt-2 border-t border-outline-variant/20">
          <StatusBadge
            loaded={anyLoaded}
            plistExists={jobs.some(([, j]) => j.plistExists)}
            loading={false}
          />
        </div>
      )}
    </div>
  );
}

// ─── JobRow ───────────────────────────────────────────────────────────────────

interface JobRowProps {
  jobId: string;
  jobStatus: JobStatus;
  isBusy: boolean;
  agentBusy: boolean;
  onAction: (action: Action) => void;
}

function JobRow({ jobId, jobStatus, isBusy, agentBusy, onAction }: JobRowProps) {
  const { loaded, plistExists, schedule, label, plistLabel } = jobStatus;
  const isLegacy = jobId === "legacy";
  const displayLabel = label || formatScheduleDisplay(schedule);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-on-surface truncate">{displayLabel}</p>
        {!isLegacy && label && (
          <p className="text-[10px] text-muted-foreground truncate">
            {formatScheduleDisplay(schedule)}
          </p>
        )}
        {!isLegacy && (
          <p className="text-[10px] text-muted-foreground font-mono truncate">
            {plistLabel ?? jobId}
          </p>
        )}
      </div>

      <StatusBadge loaded={loaded} plistExists={plistExists} loading={false} compact />

      {/* Toggle load/unload */}
      <label className="inline-flex items-center cursor-pointer shrink-0">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={loaded}
          disabled={isBusy || agentBusy || (!loaded && !plistExists)}
          onChange={() => onAction(loaded ? "unload" : "load")}
          aria-label={loaded ? "Unload" : "Load"}
        />
        <div className="relative w-8 h-4 rounded-full transition-colors duration-200 bg-slate-300 peer-checked:bg-primary peer-disabled:opacity-40 after:absolute after:content-[''] after:top-[2px] after:left-[2px] after:w-3 after:h-3 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:duration-200 peer-checked:after:translate-x-4" />
      </label>

      {/* Job-level actions */}
      <div className="flex gap-1.5 shrink-0">
        {plistExists ? (
          <>
            {!loaded && (
              <ActionBtn
                label="Load"
                variant="secondary"
                disabled={isBusy || agentBusy}
                onClick={() => onAction("load")}
              />
            )}
            <ActionBtn
              label="Remove"
              variant="danger"
              disabled={isBusy || agentBusy}
              onClick={() => onAction("delete")}
            />
          </>
        ) : (
          <ActionBtn
            label="Install"
            variant="primary"
            disabled={isBusy || agentBusy}
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
  compact = false,
}: {
  loaded: boolean;
  plistExists: boolean;
  loading: boolean;
  compact?: boolean;
}) {
  const base = compact
    ? "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
    : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest";

  if (loading) {
    return (
      <span className={`${base} bg-muted text-muted-foreground opacity-70`}>
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
        {!compact && "Checking…"}
      </span>
    );
  }
  if (loaded) {
    return (
      <span className={`${base} bg-accent text-accent-foreground`}>
        <span className="w-1.5 h-1.5 rounded-full bg-accent-foreground" />
        {compact ? "On" : "Active & Running"}
      </span>
    );
  }
  if (plistExists) {
    return (
      <span className={`${base} bg-primary/20 text-primary`}>
        <span className="w-1.5 h-1.5 rounded-full bg-primary/60" />
        {compact ? "Off" : "Installed, Not Running"}
      </span>
    );
  }
  return (
    <span className={`${base} bg-primary/10 text-primary`}>
      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
      {compact ? "–" : "Automated Scheduling"}
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
