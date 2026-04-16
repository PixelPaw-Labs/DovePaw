"use client";

import * as React from "react";
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  ChevronDown,
  FolderPlus,
  Network,
  Pencil,
  Plus,
  Trash2,
  Users2,
  WifiOff,
  X,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { z } from "zod";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { AgentGroup, AgentLink, AgentLinkStrategy } from "@@/lib/agent-links-schemas";
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

// ─── Strategy helpers ─────────────────────────────────────────────────────────

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
  defaultGroup?: string;
  onAdded: (link: AgentLink) => void;
  onCancel: () => void;
}

function AddLinkForm({
  agentConfigs,
  existingLinks,
  defaultGroup,
  onAdded,
  onCancel,
}: AddLinkFormProps) {
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
        body: JSON.stringify({ source, target, direction, strategy, group: defaultGroup }),
        signal: abortRef.current.signal,
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        throw new Error(errorResponseSchema.parse(data).error ?? "Failed to add link");
      }
      onAdded({ source, target, direction, strategy, group: defaultGroup });
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

      <div className="flex items-start gap-3 flex-wrap">
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
  allGroups: string[];
  statuses: Record<string, { online: boolean }>;
  onUpdated: (old: AgentLink, next: AgentLink) => void;
  onDeleted: (link: AgentLink) => void;
}

function LinkCard({
  link,
  agentConfigs,
  allGroups,
  statuses,
  onUpdated,
  onDeleted,
}: LinkCardProps) {
  const [editing, setEditing] = React.useState(false);
  const [editSource, setEditSource] = React.useState(link.source);
  const [editTarget, setEditTarget] = React.useState(link.target);
  const [editDirection, setEditDirection] = React.useState(link.direction);
  const [editStrategy, setEditStrategy] = React.useState<AgentLinkStrategy>(
    link.strategy ?? "parallel",
  );
  const [editGroup, setEditGroup] = React.useState(link.group ?? "");
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
    setEditGroup(link.group ?? "");
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
          group: editGroup || undefined,
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
        group: editGroup || undefined,
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
        <div className="flex items-start gap-3 flex-wrap">
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

          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Group</label>
            <select
              value={editGroup}
              onChange={(e) => setEditGroup(e.target.value)}
              disabled={busy}
              className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              <option value="">Ungrouped</option>
              {allGroups.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
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
      <div className="flex items-center gap-1.5 min-w-0">
        {!sourceOnline && <WifiOff className="w-3 h-3 text-destructive shrink-0" />}
        <span className="text-xs font-medium text-foreground/80 truncate">{sourceName}</span>
      </div>

      <span className="shrink-0 text-muted-foreground">
        {link.direction === "dual" ? (
          <ArrowLeftRight className="w-4 h-4" />
        ) : (
          <ArrowRight className="w-4 h-4" />
        )}
      </span>

      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {!targetOnline && <WifiOff className="w-3 h-3 text-destructive shrink-0" />}
        <span className="text-xs font-medium text-foreground/80 truncate">{targetName}</span>
      </div>

      <Badge variant={link.direction}>{link.direction}</Badge>

      <Badge variant={link.strategy ?? "parallel"}>
        {STRATEGY_LABELS[link.strategy ?? "parallel"]}
      </Badge>

      {!isActive && <Badge variant="inactive">inactive</Badge>}

      <button
        onClick={openEdit}
        disabled={busy}
        className="shrink-0 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Pencil className="w-3.5 h-3.5" />
        Edit
      </button>

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

// ─── Group Section ────────────────────────────────────────────────────────────

interface GroupSectionProps {
  /** null = ungrouped section */
  groupName: string | null;
  links: AgentLink[];
  allLinks: AgentLink[];
  allGroups: string[];
  agentConfigs: AgentConfigEntry[];
  statuses: Record<string, { online: boolean }>;
  onAdded: (link: AgentLink) => void;
  onUpdated: (old: AgentLink, next: AgentLink) => void;
  onDeleted: (link: AgentLink) => void;
  onGroupRenamed: (name: string, newName: string) => void;
  onGroupDeleted: (name: string) => void;
}

function GroupSection({
  groupName,
  links,
  allLinks,
  allGroups,
  agentConfigs,
  statuses,
  onAdded,
  onUpdated,
  onDeleted,
  onGroupRenamed,
  onGroupDeleted,
}: GroupSectionProps) {
  const [showForm, setShowForm] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState(groupName ?? "");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [renameBusy, setRenameBusy] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const confirmTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  React.useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming]);

  async function handleRenameSubmit() {
    if (!groupName) return;
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === groupName) {
      setRenaming(false);
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/settings/agent-links/groups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName, newName: trimmed }),
        signal: abortRef.current.signal,
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        setRenameError(errorResponseSchema.parse(data).error ?? "Failed to rename");
        return;
      }
      onGroupRenamed(groupName, trimmed);
      setRenaming(false);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setRenameError(e instanceof Error ? e.message : "Failed to rename");
    } finally {
      setRenameBusy(false);
    }
  }

  async function handleDeleteGroup() {
    if (!groupName) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmTimerRef.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDelete(false);
    setDeleteBusy(true);
    abortRef.current = new AbortController();
    try {
      await fetch("/api/settings/agent-links/groups", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName }),
        signal: abortRef.current.signal,
      });
      onGroupDeleted(groupName);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
    } finally {
      setDeleteBusy(false);
    }
  }

  function handleAdded(link: AgentLink) {
    onAdded(link);
    setShowForm(false);
  }

  const isUngrouped = groupName === null;
  const [open, setOpen] = React.useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col">
      {/* Section header — acts as the collapsible trigger row */}
      <div className="flex items-center gap-2 border-t border-border/40 pt-4 pb-2">
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-2 min-w-0 flex-1 group text-left">
            <ChevronDown
              className={cn(
                "w-4 h-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open ? "rotate-0" : "-rotate-90",
              )}
            />
            {isUngrouped ? (
              <span className="text-sm font-semibold text-muted-foreground/60 truncate">
                Ungrouped
              </span>
            ) : (
              <span className="text-sm font-semibold text-foreground truncate">{groupName}</span>
            )}
          </button>
        </CollapsibleTrigger>

        {/* Rename input (replaces the group name text while active) */}
        {!isUngrouped && renaming && (
          <div className="flex items-center gap-1.5 flex-1 -ml-6">
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRenameSubmit();
                if (e.key === "Escape") setRenaming(false);
              }}
              disabled={renameBusy}
              className="text-sm font-semibold bg-transparent border-b border-primary outline-none text-foreground w-40"
            />
            <button
              onClick={() => void handleRenameSubmit()}
              disabled={renameBusy}
              className="text-primary hover:text-primary/80"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setRenaming(false)}
              disabled={renameBusy}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            {renameError && <span className="text-xs text-destructive">{renameError}</span>}
          </div>
        )}

        {/* Per-group actions (only for named groups, not while renaming) */}
        {!isUngrouped && !renaming && (
          <>
            <button
              onClick={() => {
                setRenameValue(groupName);
                setRenameError(null);
                setRenaming(true);
              }}
              className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Rename group"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={() => void handleDeleteGroup()}
              disabled={deleteBusy}
              className={cn(
                "transition-colors",
                confirmDelete
                  ? "text-destructive"
                  : "text-muted-foreground/50 hover:text-destructive",
              )}
              title={confirmDelete ? "Click again to confirm" : "Delete group"}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}

        {!showForm && agentConfigs.length >= 2 && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Link
          </button>
        )}
      </div>

      <CollapsibleContent className="flex flex-col gap-2">
        {showForm && (
          <AddLinkForm
            agentConfigs={agentConfigs}
            existingLinks={allLinks}
            defaultGroup={groupName ?? undefined}
            onAdded={handleAdded}
            onCancel={() => setShowForm(false)}
          />
        )}

        {links.map((link) => (
          <LinkCard
            key={`${link.source}→${link.target}`}
            link={link}
            agentConfigs={agentConfigs}
            allGroups={allGroups}
            statuses={statuses}
            onUpdated={onUpdated}
            onDeleted={onDeleted}
          />
        ))}

        {links.length === 0 && !showForm && (
          <p className="text-xs text-muted-foreground/50 py-1 pl-6">
            No links.{" "}
            {agentConfigs.length >= 2 && (
              <button onClick={() => setShowForm(true)} className="text-primary hover:underline">
                Add one
              </button>
            )}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Create Group Form ────────────────────────────────────────────────────────

interface CreateGroupFormProps {
  existingGroups: string[];
  onCreated: (name: string) => void;
  onCancel: () => void;
}

function CreateGroupForm({ existingGroups, onCreated, onCancel }: CreateGroupFormProps) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    return () => abortRef.current?.abort();
  }, []);

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (existingGroups.includes(trimmed)) {
      setError(`Group "${trimmed}" already exists`);
      return;
    }
    setBusy(true);
    setError(null);
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/settings/agent-links/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
        signal: abortRef.current.signal,
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        throw new Error(errorResponseSchema.parse(data).error ?? "Failed to create group");
      }
      onCreated(trimmed);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to create group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleCreate();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Group name…"
        disabled={busy}
        className="text-sm bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-48"
      />
      <button
        onClick={() => void handleCreate()}
        disabled={busy || !name.trim()}
        className="text-sm px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {busy ? "Creating…" : "Create"}
      </button>
      <button
        onClick={onCancel}
        disabled={busy}
        className="text-sm px-3 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
      >
        Cancel
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

// ─── Main Content ─────────────────────────────────────────────────────────────

interface AgentLinksContentProps {
  agentConfigs: AgentConfigEntry[];
  tmpAgentConfigs?: AgentConfigEntry[];
  initialLinks: AgentLink[];
  initialGroups: AgentGroup[];
}

export function AgentLinksContent({
  agentConfigs,
  tmpAgentConfigs = [],
  initialLinks,
  initialGroups,
}: AgentLinksContentProps) {
  const [links, setLinks] = React.useState(initialLinks);
  const [groups, setGroups] = React.useState(initialGroups);
  const [showCreateForm, setShowCreateForm] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<"links" | "members">("links");
  const statuses = useAgentHeartbeat();

  const allConfigs = [...agentConfigs, ...tmpAgentConfigs];
  const groupNames = React.useMemo(() => groups.map((g) => g.name), [groups]);

  function getLinksForGroup(groupName: string | null): AgentLink[] {
    if (groupName === null) {
      return links.filter((l) => !l.group || !groupNames.includes(l.group));
    }
    return links.filter((l) => l.group === groupName);
  }

  function handleAdded(link: AgentLink) {
    setLinks((prev) => {
      const exists = prev.some((l) => l.source === link.source && l.target === link.target);
      return exists ? prev : [...prev, link];
    });
  }

  function handleUpdated(old: AgentLink, next: AgentLink) {
    setLinks((prev) =>
      prev.map((l) => (l.source === old.source && l.target === old.target ? next : l)),
    );
  }

  function handleDeleted(link: AgentLink) {
    setLinks((prev) => prev.filter((l) => !(l.source === link.source && l.target === link.target)));
  }

  function handleGroupCreated(name: string) {
    setGroups((prev) => [...prev, { name, members: [] }]);
    setShowCreateForm(false);
  }

  function handleGroupRenamed(name: string, newName: string) {
    setGroups((prev) => prev.map((g) => (g.name === name ? { ...g, name: newName } : g)));
    setLinks((prev) => prev.map((l) => (l.group === name ? { ...l, group: newName } : l)));
  }

  function handleGroupDeleted(name: string) {
    setGroups((prev) => prev.filter((g) => g.name !== name));
    setLinks((prev) => prev.map((l) => (l.group === name ? { ...l, group: undefined } : l)));
  }

  function handleMembersChanged(name: string, members: string[]) {
    setGroups((prev) => prev.map((g) => (g.name === name ? { ...g, members } : g)));
  }

  const ungroupedLinks = getLinksForGroup(null);
  const showUngrouped = ungroupedLinks.length > 0 || groups.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Agent Communication</h2>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Links control who can message whom via{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">chat_to_*</code> MCP tools. Group
            membership controls who appears together in a group chat — membership is independent of
            links.
          </p>
        </div>

        {activeTab === "links" && !showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors shrink-0"
          >
            <FolderPlus className="w-4 h-4" />
            New Group
          </button>
        )}
      </div>

      <div className="flex gap-0 border-b border-border/40">
        {(["links", "members"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
              activeTab === tab
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground",
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "links" ? (
        <>
          {showCreateForm && (
            <CreateGroupForm
              existingGroups={groupNames}
              onCreated={handleGroupCreated}
              onCancel={() => setShowCreateForm(false)}
            />
          )}

          {allConfigs.length < 2 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Network className="w-10 h-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Install at least two agents via Plugins to create links.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((group) => (
                <GroupSection
                  key={group.name}
                  groupName={group.name}
                  links={getLinksForGroup(group.name)}
                  allLinks={links}
                  allGroups={groupNames}
                  agentConfigs={allConfigs}
                  statuses={statuses}
                  onAdded={handleAdded}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                  onGroupRenamed={handleGroupRenamed}
                  onGroupDeleted={handleGroupDeleted}
                />
              ))}

              {showUngrouped && (
                <GroupSection
                  key="__ungrouped__"
                  groupName={null}
                  links={ungroupedLinks}
                  allLinks={links}
                  allGroups={groupNames}
                  agentConfigs={allConfigs}
                  statuses={statuses}
                  onAdded={handleAdded}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                  onGroupRenamed={handleGroupRenamed}
                  onGroupDeleted={handleGroupDeleted}
                />
              )}
            </div>
          )}
        </>
      ) : (
        <MembersTab
          groups={groups}
          agentConfigs={allConfigs}
          onMembersChanged={handleMembersChanged}
        />
      )}
    </div>
  );
}

// ─── Members Tab ──────────────────────────────────────────────────────────────

interface MembersTabProps {
  groups: AgentGroup[];
  agentConfigs: AgentConfigEntry[];
  onMembersChanged: (name: string, members: string[]) => void;
}

function MembersTab({ groups, agentConfigs, onMembersChanged }: MembersTabProps) {
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Users2 className="w-10 h-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground">No groups yet. Create one on the Links tab.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <GroupMembersRow
          key={group.name}
          group={group}
          agentConfigs={agentConfigs}
          onSaved={(members) => onMembersChanged(group.name, members)}
        />
      ))}
    </div>
  );
}

interface GroupMembersRowProps {
  group: AgentGroup;
  agentConfigs: AgentConfigEntry[];
  onSaved: (members: string[]) => void;
}

function GroupMembersRow({ group, agentConfigs, onSaved }: GroupMembersRowProps) {
  const [editing, setEditing] = React.useState(false);
  const [selected, setSelected] = React.useState(new Set(group.members));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  function openEdit() {
    setSelected(new Set(group.members));
    setError(null);
    setEditing(true);
  }

  function toggle(name: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    abortRef.current = new AbortController();
    const members = [...selected];
    try {
      const res = await fetch("/api/settings/agent-links/groups/members", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: group.name, members }),
        signal: abortRef.current.signal,
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        setError(errorResponseSchema.parse(data).error ?? "Failed to save");
        return;
      }
      onSaved(members);
      setEditing(false);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  const memberConfigs = group.members
    .map((name) => agentConfigs.find((a) => a.name === name))
    .filter((a): a is AgentConfigEntry => Boolean(a));

  return (
    <div className="border border-border rounded-xl p-5 bg-background">
      <div className="flex items-center gap-3 mb-3">
        <h3 className="text-sm font-semibold text-foreground">{group.name}</h3>
        <span className="text-xs text-muted-foreground">
          {group.members.length} member{group.members.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => (editing ? setEditing(false) : openEdit())}
          className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {editing ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
          {editing ? "Cancel" : "Edit members"}
        </button>
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto border border-border/40 rounded-lg p-2">
            {agentConfigs.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">No agents available.</p>
            ) : (
              agentConfigs.map((config) => {
                const { icon: Icon, iconBg, iconColor, displayName } = buildAgentDef(config);
                const checked = selected.has(config.name);
                return (
                  <label
                    key={config.name}
                    className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggle(config.name, e.target.checked)}
                      disabled={busy}
                      className="cursor-pointer"
                    />
                    <div className={cn("w-5 h-5 rounded flex items-center justify-center", iconBg)}>
                      <Icon className={cn("w-3 h-3", iconColor)} />
                    </div>
                    <span className="text-sm text-foreground/90">{displayName}</span>
                  </label>
                );
              })
            )}
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void handleSave()}
              disabled={busy}
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
      ) : memberConfigs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No members yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {memberConfigs.map((config) => {
            const { icon: Icon, iconBg, iconColor, displayName } = buildAgentDef(config);
            return (
              <div
                key={config.name}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-muted"
              >
                <div className={cn("w-4 h-4 rounded flex items-center justify-center", iconBg)}>
                  <Icon className={cn("w-2.5 h-2.5", iconColor)} />
                </div>
                <span>{displayName}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
