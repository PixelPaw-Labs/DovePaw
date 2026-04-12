"use client";

import * as React from "react";
import { ArrowRight, ArrowLeftRight, Network, Pencil, Plus, Trash2, WifiOff } from "lucide-react";
import { z } from "zod";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { AgentLink, AgentLinkStrategy } from "@@/lib/agent-links-schemas";
import { AGENT_LINK_STRATEGIES } from "@@/lib/agent-links-schemas";
import { useAgentHeartbeat } from "@/components/hooks/use-agent-heartbeat";
import { buildAgentDef } from "@@/lib/agents";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

const errorResponseSchema = z.object({ error: z.string().optional() });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDisplayName(configs: AgentConfigEntry[], name: string): string {
  return configs.find((c) => c.name === name)?.displayName ?? name;
}

function getManifestKey(configs: AgentConfigEntry[], name: string): string {
  return buildAgentDef(configs.find((c) => c.name === name)!).manifestKey;
}

// ─── Shared badge ────────────────────────────────────────────────────────────

type BadgeVariant =
  | "single"
  | "dual"
  | "parallel"
  | "pipeline"
  | "review"
  | "escalation"
  | "inactive";

function Badge({ children, variant }: { children: React.ReactNode; variant: BadgeVariant }) {
  return (
    <span
      className={cn(
        "shrink-0 text-[10px] uppercase tracking-widest font-semibold px-2 py-0.5 rounded-full",
        variant === "single" && "bg-muted text-muted-foreground",
        variant === "dual" && "bg-primary/10 text-primary",
        variant === "parallel" &&
          "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
        variant === "pipeline" &&
          "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
        variant === "review" &&
          "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
        variant === "escalation" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
        variant === "inactive" && "bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  );
}

// ─── Strategy descriptions ────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<AgentLinkStrategy, string> = {
  parallel: "Start & Await",
  pipeline: "Pipeline",
  review: "Review",
  escalation: "Escalation",
};

const STRATEGY_DESCRIPTIONS: Record<AgentLinkStrategy, string> = {
  parallel: "Non-blocking — source starts target then awaits concurrently",
  pipeline: "Auto-trigger — executor feeds source's output to target after completion",
  review: "Blocking review — target approves or rejects source's output",
  escalation: "Blocking escalation — source sends a blocker, target returns guidance",
};

interface StrategySelectProps {
  value: AgentLinkStrategy;
  onChange: (v: AgentLinkStrategy) => void;
  disabled?: boolean;
}

function StrategySelect({ value, onChange, disabled }: StrategySelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-muted-foreground">Strategy</label>
      <select
        value={value}
        onChange={(e) => {
          const match = AGENT_LINK_STRATEGIES.find((s) => s === e.target.value);
          if (match !== undefined) onChange(match);
        }}
        disabled={disabled}
        className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      >
        {AGENT_LINK_STRATEGIES.map((s) => (
          <option key={s} value={s}>
            {STRATEGY_LABELS[s]}
          </option>
        ))}
      </select>
      <p className="text-[10px] text-muted-foreground">{STRATEGY_DESCRIPTIONS[value]}</p>
    </div>
  );
}

// ─── Add Link Form ────────────────────────────────────────────────────────────

interface AddLinkFormProps {
  agentConfigs: AgentConfigEntry[];
  existingLinks: AgentLink[];
  onAdded: (link: AgentLink) => void;
  onCancel: () => void;
}

function AddLinkForm({ agentConfigs, existingLinks, onAdded, onCancel }: AddLinkFormProps) {
  const [source, setSource] = React.useState(agentConfigs[0]?.name ?? "");
  const [target, setTarget] = React.useState("");
  const [direction, setDirection] = React.useState<"single" | "dual">("single");
  const [strategy, setStrategy] = React.useState<AgentLinkStrategy>("parallel");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const availableTargets = agentConfigs.filter((c) => c.name !== source);

  React.useEffect(() => {
    if (!availableTargets.find((c) => c.name === target)) {
      setTarget(availableTargets[0]?.name ?? "");
    }
  }, [source, availableTargets, target]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handleAdd() {
    if (!source || !target || source === target) return;

    const conflict = existingLinks.some(
      (l) =>
        (l.source === source && l.target === target) ||
        (l.source === target && l.target === source),
    );
    if (conflict) {
      setError("A link between these agents already exists.");
      return;
    }

    setBusy(true);
    setError(null);
    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/settings/agent-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, target, direction, strategy }),
        signal: abortRef.current.signal,
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        throw new Error(errorResponseSchema.parse(data).error ?? "Failed to add link");
      }
      onAdded({ source, target, direction, strategy });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to add link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-xl p-5 bg-muted/30 flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-foreground">New Link</h3>

      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            disabled={busy}
            className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {agentConfigs.map((c) => (
              <option key={c.name} value={c.name}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Direction</label>
          <div className="flex rounded-lg border border-border overflow-hidden text-sm">
            <button
              onClick={() => setDirection("single")}
              disabled={busy}
              className={cn(
                "px-3 py-2 flex items-center gap-1.5 transition-colors",
                direction === "single"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <ArrowRight className="w-3.5 h-3.5" />
              Single
            </button>
            <button
              onClick={() => setDirection("dual")}
              disabled={busy}
              className={cn(
                "px-3 py-2 flex items-center gap-1.5 transition-colors border-l border-border",
                direction === "dual"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Dual
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={busy}
            className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {availableTargets.map((c) => (
              <option key={c.name} value={c.name}>
                {c.displayName}
              </option>
            ))}
          </select>
        </div>

        <StrategySelect value={strategy} onChange={setStrategy} disabled={busy} />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={() => void handleAdd()}
          disabled={busy || !source || !target || source === target}
          className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-sm px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Link Card ────────────────────────────────────────────────────────────────

interface LinkCardProps {
  link: AgentLink;
  agentConfigs: AgentConfigEntry[];
  statuses: Record<string, { online: boolean }>;
  onUpdated: (old: AgentLink, next: AgentLink) => void;
  onDeleted: (link: AgentLink) => void;
}

function LinkCard({ link, agentConfigs, statuses, onUpdated, onDeleted }: LinkCardProps) {
  const [editing, setEditing] = React.useState(false);
  const [editSource, setEditSource] = React.useState(link.source);
  const [editTarget, setEditTarget] = React.useState(link.target);
  const [editDirection, setEditDirection] = React.useState(link.direction);
  const [editStrategy, setEditStrategy] = React.useState<AgentLinkStrategy>(
    link.strategy ?? "parallel",
  );
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  const sourceKey = agentConfigs.find((c) => c.name === link.source)
    ? getManifestKey(agentConfigs, link.source)
    : null;
  const targetKey = agentConfigs.find((c) => c.name === link.target)
    ? getManifestKey(agentConfigs, link.target)
    : null;
  const sourceOnline = sourceKey ? (statuses[sourceKey]?.online ?? false) : false;
  const targetOnline = targetKey ? (statuses[targetKey]?.online ?? false) : false;
  const isActive = sourceOnline && targetOnline;

  React.useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  function openEdit() {
    setEditSource(link.source);
    setEditTarget(link.target);
    setEditDirection(link.direction);
    setEditStrategy(link.strategy ?? "parallel");
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (editSource === editTarget) {
      setError("An agent cannot link to itself");
      return;
    }
    setBusy(true);
    setError(null);
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/settings/agent-links", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: link.source,
          target: link.target,
          newSource: editSource,
          newTarget: editTarget,
          direction: editDirection,
          strategy: editStrategy,
        }),
        signal: abortRef.current.signal,
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        setError(errorResponseSchema.parse(data).error ?? "Failed to save");
        return;
      }
      onUpdated(link, {
        source: editSource,
        target: editTarget,
        direction: editDirection,
        strategy: editStrategy,
      });
      setEditing(false);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  function handleDeleteClick() {
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setConfirming(false);
      void doDelete();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  }

  async function doDelete() {
    setBusy(true);
    abortRef.current = new AbortController();
    try {
      await fetch("/api/settings/agent-links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: link.source, target: link.target }),
        signal: abortRef.current.signal,
      });
      onDeleted(link);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    const availableTargets = agentConfigs.filter((c) => c.name !== editSource);
    return (
      <div className="border border-primary/40 rounded-xl p-5 bg-muted/30 flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">From</label>
            <select
              value={editSource}
              onChange={(e) => setEditSource(e.target.value)}
              disabled={busy}
              className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {agentConfigs.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Direction</label>
            <div className="flex rounded-lg border border-border overflow-hidden text-sm">
              <button
                onClick={() => setEditDirection("single")}
                disabled={busy}
                className={cn(
                  "px-3 py-2 flex items-center gap-1.5 transition-colors",
                  editDirection === "single"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                Single
              </button>
              <button
                onClick={() => setEditDirection("dual")}
                disabled={busy}
                className={cn(
                  "px-3 py-2 flex items-center gap-1.5 transition-colors border-l border-border",
                  editDirection === "dual"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                <ArrowLeftRight className="w-3.5 h-3.5" />
                Dual
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">To</label>
            <select
              value={editTarget}
              onChange={(e) => setEditTarget(e.target.value)}
              disabled={busy}
              className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {availableTargets.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </div>

          <StrategySelect value={editStrategy} onChange={setEditStrategy} disabled={busy} />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={() => void handleSave()}
            disabled={busy || editSource === editTarget}
            className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const sourceName = getDisplayName(agentConfigs, link.source);
  const targetName = getDisplayName(agentConfigs, link.target);

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-4 border rounded-xl bg-background transition-colors",
        isActive ? "border-border hover:border-border/80" : "border-border/50 opacity-70",
      )}
    >
      {/* Source */}
      <div className="flex items-center gap-1.5 min-w-0">
        {!sourceOnline && <WifiOff className="w-3 h-3 text-destructive shrink-0" />}
        <span className="text-sm font-medium text-foreground truncate">{sourceName}</span>
      </div>

      {/* Arrow */}
      <span className="shrink-0 text-muted-foreground">
        {link.direction === "dual" ? (
          <ArrowLeftRight className="w-4 h-4" />
        ) : (
          <ArrowRight className="w-4 h-4" />
        )}
      </span>

      {/* Target */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {!targetOnline && <WifiOff className="w-3 h-3 text-destructive shrink-0" />}
        <span className="text-sm font-medium text-foreground truncate">{targetName}</span>
      </div>

      <Badge variant={link.direction}>{link.direction}</Badge>

      <Badge variant={link.strategy ?? "parallel"}>
        {STRATEGY_LABELS[link.strategy ?? "parallel"]}
      </Badge>

      {!isActive && <Badge variant="inactive">inactive</Badge>}

      {/* Edit */}
      <button
        onClick={openEdit}
        disabled={busy}
        className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        Edit
      </button>

      {/* Delete */}
      <button
        onClick={handleDeleteClick}
        disabled={busy}
        className={cn(
          "shrink-0 flex items-center gap-1.5 text-xs transition-colors",
          confirming
            ? "text-destructive font-medium"
            : "text-muted-foreground hover:text-destructive",
        )}
      >
        <Trash2 className="w-3.5 h-3.5" />
        {confirming ? "Confirm?" : "Remove"}
      </button>
    </div>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

interface AgentLinksContentProps {
  agentConfigs: AgentConfigEntry[];
  initialLinks: AgentLink[];
}

export function AgentLinksContent({ agentConfigs, initialLinks }: AgentLinksContentProps) {
  const [links, setLinks] = React.useState(initialLinks);
  const [showForm, setShowForm] = React.useState(false);
  const statuses = useAgentHeartbeat();

  function handleAdded(link: AgentLink) {
    setLinks((prev) => {
      const exists = prev.some((l) => l.source === link.source && l.target === link.target);
      return exists ? prev : [...prev, link];
    });
    setShowForm(false);
  }

  function handleUpdated(old: AgentLink, next: AgentLink) {
    setLinks((prev) =>
      prev.map((l) => (l.source === old.source && l.target === old.target ? next : l)),
    );
  }

  function handleDeleted(link: AgentLink) {
    setLinks((prev) => prev.filter((l) => !(l.source === link.source && l.target === link.target)));
  }

  const hasAgents = agentConfigs.length >= 2;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Agent Communication</h2>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Configure which agents can message each other. A linked agent gains a{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">chat_to_*</code> MCP tool at
            runtime. Tools are only active when both agents are connected.
          </p>
        </div>

        {hasAgents && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Link
          </button>
        )}
      </div>

      {showForm && (
        <AddLinkForm
          agentConfigs={agentConfigs}
          existingLinks={links}
          onAdded={handleAdded}
          onCancel={() => setShowForm(false)}
        />
      )}

      {links.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Network className="w-10 h-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            No links configured. Agents operate independently.
          </p>
          {hasAgents && !showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="text-sm text-primary hover:underline mt-1"
            >
              Add your first link
            </button>
          )}
          {!hasAgents && (
            <p className="text-xs text-muted-foreground/60">
              Install at least two agents via Plugins to create links.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {links.map((link) => (
            <LinkCard
              key={`${link.source}→${link.target}`}
              link={link}
              agentConfigs={agentConfigs}
              statuses={statuses}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}
