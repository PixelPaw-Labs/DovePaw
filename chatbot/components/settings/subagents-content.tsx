"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bot, Info, RefreshCw } from "lucide-react";
import { AddAgentDialog } from "./add-agent-dialog";
import { EditAgentDialog } from "./edit-agent-dialog";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buildAgentDef } from "@@/lib/agents";
import { z } from "zod";
import { agentConfigEntrySchema } from "@@/lib/agents-config-schemas";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";

const apiErrorSchema = z.object({ error: z.string().optional() });
const agentsResponseSchema = z.object({ agents: z.array(agentConfigEntrySchema) });

interface SubagentsContentProps {
  initialAgents: AgentConfigEntry[];
}

export function SubagentsContent({ initialAgents }: SubagentsContentProps) {
  const router = useRouter();
  const [agents, setAgents] = React.useState<AgentConfigEntry[]>(initialAgents);
  const [editingAgent, setEditingAgent] = React.useState<AgentConfigEntry | null>(null);
  const [deletingName, setDeletingName] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pendingRestart, setPendingRestart] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);

  const abortRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => abortRef.current?.abort(), []);

  async function mutate(
    request: (signal: AbortSignal) => Promise<AgentConfigEntry[]>,
    errorMsg: string,
    onFinally?: () => void,
  ) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSaving(true);
    setError(null);
    try {
      const updated = await request(controller.signal);
      if (controller.signal.aborted) return;
      setAgents(updated);
      setPendingRestart(true);
      router.refresh();
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : errorMsg);
    } finally {
      if (!controller.signal.aborted) {
        setSaving(false);
        onFinally?.();
      }
    }
  }

  async function handleAdd(entry: AgentConfigEntry) {
    await mutate(async (signal) => {
      const res = await fetch("/api/settings/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
        signal,
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error(apiErrorSchema.parse(json).error ?? "Failed to add agent");
      return agentsResponseSchema.parse(json).agents;
    }, "Failed to add agent");
  }

  async function handleEdit(entry: AgentConfigEntry) {
    await mutate(async (signal) => {
      const res = await fetch("/api/settings/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: entry.name, patch: entry }),
        signal,
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error(apiErrorSchema.parse(json).error ?? "Failed to update agent");
      return agentsResponseSchema.parse(json).agents;
    }, "Failed to update agent");
  }

  async function handleDelete(name: string) {
    await mutate(
      async (signal) => {
        const res = await fetch("/api/settings/agents", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
          signal,
        });
        const json: unknown = await res.json();
        if (!res.ok) throw new Error(apiErrorSchema.parse(json).error ?? "Failed to delete agent");
        return agentsResponseSchema.parse(json).agents;
      },
      "Failed to delete agent",
      () => setDeletingName(null),
    );
  }

  async function handleRestart() {
    setRestarting(true);
    setError(null);
    try {
      const res = await fetch("/api/servers/restart", { method: "POST" });
      if (!res.ok) {
        const data = apiErrorSchema.parse(await res.json());
        throw new Error(data.error ?? "Restart failed");
      }
      setPendingRestart(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restart failed");
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumb
        items={[{ label: "Settings", href: "/settings" }, { label: "Subagent Config" }]}
      />

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-on-surface tracking-tight">
            Subagent Configuration
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Manage agent definitions stored in{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              ~/.dovepaw/agents.json
            </code>
            {saving && <span className="ml-2 text-primary">Saving…</span>}
          </p>
        </div>
        <AddAgentDialog existingNames={agents.map((a) => a.name)} onAdd={handleAdd} />
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Pending restart banner — shown after any change */}
      {pendingRestart ? (
        <div className="flex items-center gap-3 rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3">
          <Info className="w-4 h-4 text-yellow-600 shrink-0" />
          <p className="text-sm text-yellow-800 flex-1">
            Config changed — A2A servers need a restart to pick up the new agents.
          </p>
          <button
            type="button"
            disabled={restarting}
            onClick={() => void handleRestart()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold bg-yellow-600 text-white hover:brightness-110 disabled:opacity-50 shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${restarting ? "animate-spin" : ""}`} />
            {restarting ? "Restarting…" : "Restart Now"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
          <Info className="w-4 h-4 text-primary shrink-0" />
          <p className="text-sm text-on-surface-variant">
            Agent config is live — restart A2A servers to apply any changes.
          </p>
        </div>
      )}

      {/* Agent grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {agents.map((entry) => (
          <AgentCard
            key={entry.name}
            entry={entry}
            isDeleting={deletingName === entry.name}
            isSaving={saving}
            onEdit={() => setEditingAgent(entry)}
            onDeleteRequest={() => setDeletingName(entry.name)}
            onDeleteCancel={() => setDeletingName(null)}
            onDeleteConfirm={() => void handleDelete(entry.name)}
          />
        ))}
      </div>

      <EditAgentDialog
        agent={editingAgent}
        onSave={(entry) => void handleEdit(entry)}
        onClose={() => setEditingAgent(null)}
      />
    </div>
  );
}

function AgentCard({
  entry,
  isDeleting,
  isSaving,
  onEdit,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  entry: AgentConfigEntry;
  isDeleting: boolean;
  isSaving: boolean;
  onEdit: () => void;
  onDeleteRequest: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const agent = buildAgentDef(entry);
  const Icon = agent.icon ?? Bot;
  const schedulingEnabled = entry.schedulingEnabled !== false;

  return (
    <div className="bg-surface-container-lowest rounded-xl shadow-[0_4px_16px_-4px_rgba(43,52,55,0.08)] flex flex-col gap-4 p-6 transition-all">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${agent.iconBg} ${agent.iconColor}`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-on-surface text-sm leading-tight">{agent.displayName}</h3>
          <p className="text-xs text-on-surface-variant mt-0.5 font-mono">{agent.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {schedulingEnabled ? agent.scheduleDisplay : "scheduling disabled"}
          </p>
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-on-surface-variant line-clamp-3">{entry.description}</p>

      {/* Actions */}
      <div className="flex flex-wrap gap-2 mt-auto pt-2 border-t border-outline-variant/20">
        {isDeleting ? (
          <>
            <span className="text-xs text-destructive font-medium flex-1 self-center">
              Delete "{agent.displayName}"?
            </span>
            <button
              type="button"
              disabled={isSaving}
              onClick={onDeleteConfirm}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-destructive text-destructive-foreground hover:brightness-110 disabled:opacity-40"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-secondary border border-border text-foreground hover:brightness-95"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={isSaving}
              onClick={onEdit}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-primary text-primary-foreground hover:brightness-110 disabled:opacity-40"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={onDeleteRequest}
              className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 disabled:opacity-40"
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
