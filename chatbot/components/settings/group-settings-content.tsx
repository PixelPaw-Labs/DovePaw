"use client";

import * as React from "react";
import Link from "next/link";
import { FolderGit2, KeyRound, Lock, Eye, EyeOff, Pencil, Trash2, Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddEnvVarDialog } from "./add-env-var-dialog";
import { EditEnvVarDialog } from "./edit-env-var-dialog";
import {
  DataTable,
  DataTableHeader,
  DataTableRow,
  DataTableEmpty,
  headerCellClass,
} from "./data-table";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { z } from "zod";
import { type Repository, type EnvVar, envVarSchema } from "@@/lib/settings-schemas";

const envVarsResponseSchema = z.object({ envVars: z.array(envVarSchema) });

type Tab = "repositories" | "env-vars";

interface GroupSettingsContentProps {
  groupName: string;
  repositories: Repository[];
  initialEnabledRepoIds: string[];
  initialGroupEnvVars: EnvVar[];
  globalEnvVars: EnvVar[];
  initialTab?: Tab;
}

function MaskedValue({
  value,
  isSecret,
  keychainService,
  keychainAccount,
}: {
  value: string;
  isSecret: boolean;
  keychainService?: string;
  keychainAccount?: string;
}) {
  const [visible, setVisible] = React.useState(false);

  if (!isSecret) {
    return <span className="text-xs font-mono text-on-surface-variant truncate">{value}</span>;
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xs font-mono text-on-surface-variant truncate">
        {visible ? value : "•".repeat(Math.min(value.length || 8, 24))}
      </span>
      <span className="shrink-0 text-[10px] font-medium text-primary/70 bg-primary/10 rounded px-1 py-0.5 leading-none">
        {keychainService ? `${keychainService} / ${keychainAccount ?? ""}` : "keychain"}
      </span>
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="shrink-0 text-on-surface-variant/50 hover:text-on-surface-variant transition-colors"
        title={visible ? "Hide value" : "Show value"}
      >
        {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function GroupSettingsContent({
  groupName,
  repositories,
  initialEnabledRepoIds,
  initialGroupEnvVars,
  globalEnvVars,
  initialTab = "repositories",
}: GroupSettingsContentProps) {
  const [tab, setTab] = React.useState<Tab>(initialTab);

  // ── repos state ──────────────────────────────────────────────────────────────
  const [enabledIds, setEnabledIds] = React.useState<Set<string>>(
    () => new Set(initialEnabledRepoIds),
  );
  const [repoSaving, setRepoSaving] = React.useState(false);

  const enabledCount = enabledIds.size;
  const totalCount = repositories.length;

  async function saveRepoToggle(next: Set<string>) {
    setRepoSaving(true);
    try {
      await fetch("/api/settings/group-repos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupName, enabledRepoIds: Array.from(next) }),
      });
    } finally {
      setRepoSaving(false);
    }
  }

  function handleToggleRepo(repoId: string) {
    const next = new Set(enabledIds);
    if (next.has(repoId)) {
      next.delete(repoId);
    } else {
      next.add(repoId);
    }
    setEnabledIds(next);
    void saveRepoToggle(next);
  }

  // ── env vars state ───────────────────────────────────────────────────────────
  const [groupEnvVars, setGroupEnvVars] = React.useState(initialGroupEnvVars);
  const overriddenKeys = new Set(groupEnvVars.map((v) => v.key));
  const inheritedGlobals = globalEnvVars.filter((v) => !overriddenKeys.has(v.key));
  const [editingEnvVar, setEditingEnvVar] = React.useState<EnvVar | null>(null);
  const [deletingEnvVarId, setDeletingEnvVarId] = React.useState<string | null>(null);
  const [envSaving, setEnvSaving] = React.useState(false);

  React.useEffect(() => {
    fetch(`/api/settings/group-env-vars?groupName=${encodeURIComponent(groupName)}`)
      .then((r) => r.json())
      .then((data: { envVars: EnvVar[] }) => setGroupEnvVars(data.envVars))
      .catch(() => {});
  }, [groupName]);

  async function handleAddEnvVar(
    key: string,
    value: string,
    isSecret: boolean,
    keychainService?: string,
    keychainAccount?: string,
  ) {
    setEnvSaving(true);
    try {
      const res = await fetch("/api/settings/group-env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupName, key, value, isSecret, keychainService, keychainAccount }),
      });
      if (res.ok) {
        const data = envVarsResponseSchema.parse(await res.json());
        setGroupEnvVars(data.envVars);
      }
    } finally {
      setEnvSaving(false);
    }
  }

  async function handleEditEnvVar(
    id: string,
    key: string,
    value: string,
    isSecret: boolean,
    keychainService?: string,
    keychainAccount?: string,
  ) {
    setEnvSaving(true);
    try {
      const res = await fetch("/api/settings/group-env-vars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName,
          id,
          key,
          value,
          isSecret,
          keychainService,
          keychainAccount,
        }),
      });
      if (res.ok) {
        const data = envVarsResponseSchema.parse(await res.json());
        setGroupEnvVars(data.envVars);
      }
    } finally {
      setEnvSaving(false);
    }
  }

  async function handleRemoveEnvVar(id: string) {
    setEnvSaving(true);
    try {
      const res = await fetch("/api/settings/group-env-vars", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupName, id }),
      });
      if (res.ok) {
        const data = envVarsResponseSchema.parse(await res.json());
        setGroupEnvVars(data.envVars);
      }
    } finally {
      setEnvSaving(false);
    }
  }

  const saving = repoSaving || envSaving;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-primary/10">
            <Users2 className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-on-surface tracking-tight">{groupName}</h1>
            <p className="text-sm text-on-surface-variant mt-1">
              Shared configuration for all members of this group.
              {saving && <span className="ml-2 text-primary">Saving…</span>}
            </p>
          </div>
        </div>
        {tab === "env-vars" && (
          <AddEnvVarDialog existingKeys={groupEnvVars.map((v) => v.key)} onAdd={handleAddEnvVar} />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
        <div className="flex flex-col gap-4">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-outline-variant/20">
            <button
              type="button"
              onClick={() => setTab("repositories")}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === "repositories"
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Repositories
              <span className="ml-2 text-xs font-normal opacity-60">
                ({enabledCount} of {totalCount})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTab("env-vars")}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === "env-vars"
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant hover:text-on-surface"
              }`}
            >
              Environment Variables
              {groupEnvVars.length > 0 && (
                <span className="ml-2 text-xs font-normal opacity-60">
                  ({groupEnvVars.length} override{groupEnvVars.length !== 1 ? "s" : ""})
                </span>
              )}
            </button>
          </div>

          {/* Repositories tab */}
          {tab === "repositories" && (
            <>
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
                  Repositories
                </h3>
                <span className="text-xs text-on-surface-variant opacity-60">
                  {enabledCount} of {totalCount} enabled
                </span>
                <div className="flex-1 h-px bg-outline-variant/20" />
              </div>

              {repositories.length === 0 ? (
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container">
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
                    <FolderGit2 className="w-10 h-10 opacity-30" />
                    <p className="text-sm font-medium">No repositories configured</p>
                    <p className="text-xs opacity-60">
                      Add repositories in{" "}
                      <Link href="/settings" className="underline hover:text-on-surface">
                        Global Settings
                      </Link>
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {repositories.map((repo) => {
                    const enabled = enabledIds.has(repo.id);
                    return (
                      <div
                        key={repo.id}
                        className="bg-surface-container-lowest rounded-xl shadow-[0_4px_16px_-4px_rgba(43,52,55,0.08)] flex items-center justify-between px-6 py-5 transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary shrink-0 group-hover:scale-110 transition-transform">
                            <FolderGit2 className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-on-surface text-sm">{repo.name}</h4>
                            <p className="text-xs font-mono text-on-surface-variant mt-0.5">
                              {repo.githubRepo}
                            </p>
                          </div>
                        </div>
                        <label className="inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={enabled}
                            onChange={() => handleToggleRepo(repo.id)}
                            aria-label={`${enabled ? "Disable" : "Enable"} ${repo.name} for ${groupName}`}
                          />
                          <div className="relative w-11 h-6 rounded-full transition-colors duration-200 bg-slate-300 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 after:absolute after:content-[''] after:top-[2px] after:left-[2px] after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:duration-200 peer-checked:after:translate-x-5" />
                        </label>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Environment Variables tab */}
          {tab === "env-vars" && (
            <>
              <p className="text-xs text-on-surface-variant">
                Group-specific overrides take precedence over global values. Inherited globals are
                read-only here — edit them in{" "}
                <Link href="/settings" className="underline hover:text-on-surface">
                  Global Settings
                </Link>
                .
              </p>

              {groupEnvVars.length === 0 && inheritedGlobals.length === 0 ? (
                <DataTableEmpty
                  icon={KeyRound}
                  title="No environment variables"
                  description="Add an override or configure global variables in Settings"
                />
              ) : (
                <DataTable cols="grid-cols-[auto_1fr_2fr_5rem]">
                  <DataTableHeader>
                    <span className={headerCellClass}>Source</span>
                    <span className={headerCellClass}>Key</span>
                    <span className={headerCellClass}>Value</span>
                    <span className="invisible" aria-hidden="true">
                      Actions
                    </span>
                  </DataTableHeader>

                  {groupEnvVars.map((envVar, i) => (
                    <DataTableRow
                      key={envVar.id}
                      isLast={i === groupEnvVars.length - 1 && inheritedGlobals.length === 0}
                    >
                      {deletingEnvVarId === envVar.id ? (
                        <div className="col-span-full flex items-center gap-3 py-1">
                          <span className="text-xs text-destructive font-medium ml-auto">
                            Delete &ldquo;{envVar.key}&rdquo;?
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              void handleRemoveEnvVar(envVar.id);
                              setDeletingEnvVarId(null);
                            }}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-destructive text-destructive-foreground hover:brightness-110"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingEnvVarId(null)}
                            className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-secondary border border-border text-foreground hover:brightness-95"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 leading-none shrink-0 self-center bg-primary/10 text-primary">
                            group
                          </span>
                          <div className="flex items-center gap-2 min-w-0">
                            {envVar.isSecret ? (
                              <Lock className="w-4 h-4 text-primary shrink-0" />
                            ) : (
                              <KeyRound className="w-4 h-4 text-primary shrink-0" />
                            )}
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-sm font-mono font-semibold text-on-surface truncate">
                                    {envVar.key}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{envVar.key}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                          <MaskedValue
                            value={envVar.value}
                            isSecret={envVar.isSecret}
                            keychainService={envVar.keychainService}
                            keychainAccount={envVar.keychainAccount}
                          />
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingEnvVar(envVar)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high h-8 w-8 p-0"
                              title={`Edit ${envVar.key}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeletingEnvVarId(envVar.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-error hover:bg-error-container/30 h-8 w-8 p-0"
                              title={`Remove ${envVar.key}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </>
                      )}
                    </DataTableRow>
                  ))}

                  {/* Inherited globals (read-only) */}
                  {inheritedGlobals.map((envVar, i) => (
                    <DataTableRow key={envVar.id} isLast={i === inheritedGlobals.length - 1}>
                      <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 leading-none shrink-0 self-center bg-surface-container text-on-surface-variant">
                        inherited
                      </span>
                      <div className="flex items-center gap-2 min-w-0">
                        {envVar.isSecret ? (
                          <Lock className="w-4 h-4 text-primary/50 shrink-0" />
                        ) : (
                          <KeyRound className="w-4 h-4 text-primary/50 shrink-0" />
                        )}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-sm font-mono font-semibold text-on-surface/60 truncate">
                                {envVar.key}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{envVar.key}</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      <MaskedValue
                        value={envVar.value}
                        isSecret={envVar.isSecret}
                        keychainService={envVar.keychainService}
                        keychainAccount={envVar.keychainAccount}
                      />
                      <span />
                    </DataTableRow>
                  ))}
                </DataTable>
              )}
            </>
          )}
        </div>

        {/* Info sidebar */}
        <div className="flex flex-col gap-4 sticky top-24">
          <div className="rounded-xl bg-primary-container p-6 text-on-primary-container relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <Users2 className="w-16 h-16" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-widest mb-4 relative z-10">
              Group Info
            </h3>
            <div className="space-y-3 relative z-10">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-tighter opacity-70">
                  Repositories
                </p>
                <p className="text-sm font-semibold">
                  {enabledCount} / {totalCount} enabled
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-tighter opacity-70">
                  Env Variables
                </p>
                <p className="text-sm font-semibold">{groupEnvVars.length} configured</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <EditEnvVarDialog
        envVar={editingEnvVar}
        existingKeys={groupEnvVars.map((v) => v.key)}
        onSave={handleEditEnvVar}
        onClose={() => setEditingEnvVar(null)}
      />
    </div>
  );
}
