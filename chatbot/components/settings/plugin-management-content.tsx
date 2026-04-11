"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { z } from "zod";
import { pluginRecordSchema } from "@@/lib/plugin-schemas";
import type { PluginRecord } from "@@/lib/plugin-schemas";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

const listResponseSchema = z.object({ plugins: z.array(pluginRecordSchema) });
const pluginResponseSchema = z.object({ plugin: pluginRecordSchema });
const errorResponseSchema = z.object({ error: z.string().optional() });

// ─── Shared: restart A2A servers ──────────────────────────────────────────────

/**
 * Signal the running A2A servers process to restart so it picks up newly
 * registered (or removed) plugin agents. Fire-and-forget — errors are
 * silently ignored because Electron auto-restarts on SIGTERM anyway.
 */
async function restartServers(): Promise<void> {
  try {
    await fetch("/api/servers/restart", { method: "POST" });
  } catch {
    // Best effort — Electron will restart the process independently
  }
}

// ─── Add Plugin Dialog ────────────────────────────────────────────────────────

interface AddPluginDialogProps {
  onClose: () => void;
  onAdded: (plugin: PluginRecord) => void;
}

function AddPluginDialog({ onClose, onAdded }: AddPluginDialogProps) {
  const [source, setSource] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleAdd() {
    if (!source.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/plugins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: source.trim() }),
      });
      const data: unknown = await res.json();
      if (!res.ok) throw new Error(errorResponseSchema.parse(data).error ?? "Failed to add plugin");
      const { plugin } = pluginResponseSchema.parse(data);
      // Restart servers to pick up the new agents, then hand off to parent
      void restartServers();
      onAdded(plugin);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add plugin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
        <h2 className="text-lg font-bold text-foreground">Add Plugin</h2>
        <p className="text-sm text-muted-foreground">
          Enter a Git URL (e.g.{" "}
          <code className="font-mono text-xs">git@github.com:user/Plugins</code>) or an absolute
          local path to the plugin directory.
        </p>

        <input
          type="text"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
          placeholder="git@github.com:user/MyPlugins or /path/to/plugins"
          className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg outline-none focus:ring-2 focus:ring-primary/40 font-mono"
          autoFocus
        />

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 mt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={busy || !source.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Plugin Card ──────────────────────────────────────────────────────────────

interface PluginCardProps {
  plugin: PluginRecord;
  busy: boolean;
  onUpdate: () => void;
  onSync: () => void;
  onRemove: () => void;
}

function PluginCard({ plugin, busy, onUpdate, onSync, onRemove }: PluginCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const confirmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const installedDate = new Date(plugin.installedAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  function handleRemoveClick() {
    if (confirming) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirming(false);
      onRemove();
    } else {
      setConfirming(true);
      confirmTimerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  }

  React.useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  return (
    <div className="border border-border/60 rounded-xl bg-card overflow-hidden">
      {/* Card header */}
      <div className="p-5 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-0.5 min-w-0">
            <p className="font-bold text-foreground text-base">{plugin.name}</p>
            {plugin.gitUrl && (
              <p className="text-xs text-muted-foreground font-mono truncate">{plugin.gitUrl}</p>
            )}
            <p className="text-xs text-muted-foreground/70 mt-0.5">Installed {installedDate}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {plugin.gitUrl && (
              <button
                type="button"
                onClick={onUpdate}
                disabled={busy}
                title="Pull latest changes and sync"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
              >
                <RefreshCw className="w-3 h-3" />
                Update
              </button>
            )}
            <button
              type="button"
              onClick={onSync}
              disabled={busy}
              title="Re-read manifest without git pull"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              Sync
            </button>
            <button
              type="button"
              onClick={handleRemoveClick}
              disabled={busy}
              title="Remove plugin from registry"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-40",
                confirming
                  ? "border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Trash2 className="w-3 h-3" />
              {confirming ? "Confirm?" : "Remove"}
            </button>
          </div>
        </div>

        {/* Agent list toggle */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {plugin.agentNames.length} agent{plugin.agentNames.length !== 1 ? "s" : ""}
        </button>
      </div>

      {/* Collapsible agent list */}
      {expanded && (
        <div className="border-t border-border/40 bg-muted/30 px-5 py-3 flex flex-col gap-1">
          {plugin.agentNames.map((name) => (
            <p key={name} className="text-sm text-muted-foreground font-mono">
              • {name}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface PluginManagementContentProps {
  initialPlugins: PluginRecord[];
}

export function PluginManagementContent({ initialPlugins }: PluginManagementContentProps) {
  const [plugins, setPlugins] = React.useState<PluginRecord[]>(initialPlugins);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const noticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    fetch("/api/settings/plugins", { signal: ac.signal })
      .then((r) => r.json())
      .then((data) => setPlugins(listResponseSchema.parse(data).plugins))
      .catch(() => {
        /* ignore — initialPlugins already shown */
      });
    return () => ac.abort();
  }, []);

  React.useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 5000);
  }

  async function callPluginAction(pluginName: string, url: string, method: string): Promise<void> {
    setBusy(pluginName);
    setError(null);
    try {
      const res = await fetch(url, { method });
      const data: unknown = await res.json();
      if (!res.ok) throw new Error(errorResponseSchema.parse(data).error ?? "Action failed");

      if (method === "DELETE") {
        setPlugins((prev) => prev.filter((p) => p.name !== pluginName));
        void restartServers();
        showNotice("Plugin removed — servers restarting to apply changes.");
      } else {
        const { plugin } = pluginResponseSchema.parse(data);
        setPlugins((prev) => prev.map((p) => (p.name === plugin.name ? plugin : p)));
        void restartServers();
        showNotice(`Plugin "${plugin.name}" synced — servers restarting to apply changes.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Section header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-foreground tracking-tight">
            Installed Plugins
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Plugins extend DovePaw with additional agents. After adding a plugin, run{" "}
            <code className="font-mono text-xs">npm run install</code> to build and deploy the new
            agents as daemons.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddDialog(true)}
          className="flex items-center gap-2 px-4 py-2 text-sm rounded-xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          Add Plugin
        </button>
      </div>

      {notice && (
        <div className="px-4 py-3 rounded-xl bg-primary/10 border border-primary/30 text-sm text-primary">
          {notice}
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Plugin list */}
      {plugins.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <p className="text-base font-medium text-foreground/60">No plugins installed</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Add your first plugin by clicking{" "}
            <button
              type="button"
              onClick={() => setShowAddDialog(true)}
              className="underline hover:text-foreground transition-colors"
            >
              Add Plugin
            </button>{" "}
            and providing a Git URL or local path.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.name}
              plugin={plugin}
              busy={busy === plugin.name}
              onUpdate={() =>
                void callPluginAction(
                  plugin.name,
                  `/api/settings/plugins/${plugin.name}/update`,
                  "POST",
                )
              }
              onSync={() =>
                void callPluginAction(
                  plugin.name,
                  `/api/settings/plugins/${plugin.name}/update?action=sync`,
                  "POST",
                )
              }
              onRemove={() =>
                void callPluginAction(plugin.name, `/api/settings/plugins/${plugin.name}`, "DELETE")
              }
            />
          ))}
        </div>
      )}

      {showAddDialog && (
        <AddPluginDialog
          onClose={() => setShowAddDialog(false)}
          onAdded={(plugin) => {
            setPlugins((prev) => {
              const exists = prev.find((p) => p.name === plugin.name);
              return exists
                ? prev.map((p) => (p.name === plugin.name ? plugin : p))
                : [...prev, plugin];
            });
            setShowAddDialog(false);
            showNotice(
              `Registered ${plugin.agentNames.length} agent${plugin.agentNames.length !== 1 ? "s" : ""} — servers restarting to activate them.`,
            );
          }}
        />
      )}
    </div>
  );
}
