"use client";

import * as React from "react";
import Link from "next/link";
import { FolderGit2 } from "lucide-react";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { buildAgentDef } from "@@/lib/agents";
import { type AgentConfigEntry, formatScheduleDisplay } from "@@/lib/agents-config-schemas";
import type { Repository } from "@@/lib/settings-schemas";

interface AgentRepoSettingsProps {
  agentEntry: AgentConfigEntry;
  repositories: Repository[];
  initialEnabledRepoIds: string[];
}

export function AgentRepoSettings({
  agentEntry,
  repositories,
  initialEnabledRepoIds,
}: AgentRepoSettingsProps) {
  const agent = buildAgentDef(agentEntry);

  const Icon = agent.icon;

  const [enabledIds, setEnabledIds] = React.useState<Set<string>>(
    () => new Set(initialEnabledRepoIds),
  );
  const [saving, setSaving] = React.useState(false);

  async function saveToggle(next: Set<string>) {
    setSaving(true);
    try {
      await fetch("/api/settings/agent-repos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentName: agentEntry.name,
          enabledRepoIds: Array.from(next),
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  function handleToggle(repoId: string) {
    const next = new Set(enabledIds);
    if (next.has(repoId)) {
      next.delete(repoId);
    } else {
      next.add(repoId);
    }
    setEnabledIds(next);
    void saveToggle(next);
  }

  const enabledCount = enabledIds.size;
  const totalCount = repositories.length;

  return (
    <div className="flex flex-col gap-8">
      <Breadcrumb
        items={[{ label: "Settings", href: "/settings" }, { label: agent.displayName }]}
      />

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0 mt-0.5">
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-on-surface tracking-tight">
              Repository settings for &lsquo;{agent.displayName}&rsquo;
            </h1>
            <p className="text-sm text-on-surface-variant mt-1 max-w-2xl">
              Enable or disable which repositories this agent monitors. Only enabled repositories
              are considered during execution. Changes save automatically.
              {saving && <span className="ml-2 text-primary">Saving…</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Agent info + repo list layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8 items-start">
        {/* Repo list */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 mb-1">
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

                    {/* Toggle switch */}
                    <label className="inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={enabled}
                        onChange={() => handleToggle(repo.id)}
                        aria-label={`${enabled ? "Disable" : "Enable"} ${repo.name} for ${agent.displayName}`}
                      />
                      <div className="relative w-11 h-6 rounded-full transition-colors duration-200 bg-slate-300 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 after:absolute after:content-[''] after:top-[2px] after:left-[2px] after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:duration-200 peer-checked:after:translate-x-5" />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Agent info sidebar */}
        <div className="flex flex-col gap-4 sticky top-24">
          <div className="rounded-xl bg-primary-container p-6 text-on-primary-container relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <Icon className="w-16 h-16" />
            </div>
            <h3 className="text-xs font-bold uppercase tracking-widest mb-4 relative z-10">
              Agent Info
            </h3>
            <div className="space-y-3 relative z-10">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-tighter opacity-70">
                  Schedule
                </p>
                <p className="text-sm font-semibold">{formatScheduleDisplay(agent.schedule)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-tighter opacity-70">
                  Description
                </p>
                <p className="text-xs leading-relaxed opacity-80">{agent.description}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-5">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant mb-3">
              Status
            </h3>
            <div className="flex items-center justify-between">
              <span className="text-sm text-on-surface">Enabled repos</span>
              <span className="text-sm font-bold text-primary">
                {enabledCount} / {totalCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
