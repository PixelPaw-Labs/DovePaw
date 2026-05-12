"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { StatsCards } from "./stats-cards";
import { RepoTable } from "./repo-table";
import { AddRepoDialog } from "./add-repo-dialog";
import { EditRepoDialog } from "./edit-repo-dialog";
import { EnvVarTable } from "./env-var-table";
import { AddEnvVarDialog } from "./add-env-var-dialog";
import { EditEnvVarDialog } from "./edit-env-var-dialog";
import { AgentManagementContent } from "./agent-management-content";
import { DoveDefinitionTab } from "./dove-definition-tab";
import { OpenVikingTab } from "./openviking-tab";
import { useAgentHeartbeat } from "@/components/hooks/use-agent-heartbeat";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { PluginRecord } from "@@/lib/plugin-schemas";
import { z } from "zod";
import {
  type GlobalSettings,
  type Repository,
  type EnvVar,
  globalSettingsSchema,
  envVarSchema,
  effectiveDoveSettings,
} from "@@/lib/settings-schemas";

const envVarsResponseSchema = z.object({ envVars: z.array(envVarSchema) });

const VALID_TABS = ["dove", "repositories", "env-vars", "agent-management", "memory"] as const;
type Tab = (typeof VALID_TABS)[number];

function parseTabParam(raw: string | null | undefined): Tab | null {
  return VALID_TABS.find((t) => t === raw) ?? null;
}

interface SettingsContentProps {
  initialSettings: GlobalSettings;
  initialAgentRepos: Record<string, string[]>;
  agentConfigs: AgentConfigEntry[];
  scheduledAgentConfigs: AgentConfigEntry[];
  plugins?: readonly Pick<PluginRecord, "path" | "name">[];
}

export function SettingsContent({
  initialSettings,
  initialAgentRepos,
  agentConfigs,
  scheduledAgentConfigs,
  plugins = [],
}: SettingsContentProps) {
  const doveDisplayName = effectiveDoveSettings(initialSettings).displayName;
  const searchParams = useSearchParams();
  const [tab, setTab] = React.useState<Tab>(
    () => parseTabParam(searchParams?.get("tab")) ?? "dove",
  );
  const [repositories, setRepositories] = React.useState(initialSettings.repositories);
  const [editingRepo, setEditingRepo] = React.useState<Repository | null>(null);
  // Fetch env vars from API on mount so secrets have their real keychain values
  const [envVars, setEnvVars] = React.useState(initialSettings.envVars);
  const [editingEnvVar, setEditingEnvVar] = React.useState<EnvVar | null>(null);
  const [saving, setSaving] = React.useState(false);
  const statuses = useAgentHeartbeat();

  React.useEffect(() => {
    fetch("/api/settings/env-vars")
      .then((r) => r.json())
      .then((data: { envVars: EnvVar[] }) => setEnvVars(data.envVars))
      .catch(() => {
        // keep initialSettings values on error
      });
  }, []);

  async function saveRepositories(next: Repository[]) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repositories: next.map((r) => ({ githubRepo: r.githubRepo })) }),
      });
      if (res.ok) {
        const updated = globalSettingsSchema.parse(await res.json());
        setRepositories(updated.repositories);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleAddRepo(githubRepo: string) {
    const name = githubRepo.split("/").at(-1) ?? githubRepo;
    const next = [...repositories, { id: crypto.randomUUID(), name, githubRepo }];
    setRepositories(next);
    void saveRepositories(next);
  }

  function handleEditRepo(id: string, githubRepo: string, name: string) {
    const next = repositories.map((r) => (r.id === id ? { id, name, githubRepo } : r));
    setRepositories(next);
    void saveRepositories(next);
  }

  function handleRemoveRepo(id: string) {
    const next = repositories.filter((r) => r.id !== id);
    setRepositories(next);
    void saveRepositories(next);
  }

  async function handleAddEnvVar(
    key: string,
    value: string,
    isSecret: boolean,
    keychainService?: string,
    keychainAccount?: string,
  ) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/env-vars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, isSecret, keychainService, keychainAccount }),
      });
      if (res.ok) {
        const data = envVarsResponseSchema.parse(await res.json());
        setEnvVars(data.envVars);
      }
    } finally {
      setSaving(false);
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
    setSaving(true);
    try {
      const res = await fetch("/api/settings/env-vars", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, key, value, isSecret, keychainService, keychainAccount }),
      });
      if (res.ok) {
        const data = envVarsResponseSchema.parse(await res.json());
        setEnvVars(data.envVars);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveEnvVar(id: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/env-vars", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        const data = envVarsResponseSchema.parse(await res.json());
        setEnvVars(data.envVars);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-on-surface tracking-tight">
            Global Settings
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Configure repositories and environment variables for all agents.
            {saving && <span className="ml-2 text-primary">Saving…</span>}
          </p>
        </div>
        {tab === "repositories" ? (
          <AddRepoDialog
            existingGithubRepos={repositories.map((r) => r.githubRepo)}
            onAdd={handleAddRepo}
          />
        ) : tab === "env-vars" ? (
          <AddEnvVarDialog existingKeys={envVars.map((v) => v.key)} onAdd={handleAddEnvVar} />
        ) : null}
      </div>

      {/* Stats */}
      <StatsCards
        repoCount={repositories.length}
        agentCount={agentConfigs.length}
        statuses={statuses}
      />

      {/* Tabs */}
      <div className="flex flex-col gap-4">
        <div className="flex gap-1 border-b border-outline-variant/20">
          <button
            type="button"
            onClick={() => setTab("dove")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === "dove"
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {doveDisplayName}
          </button>
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
            <span className="ml-2 text-xs font-normal opacity-60">({repositories.length})</span>
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
            <span className="ml-2 text-xs font-normal opacity-60">({envVars.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("agent-management")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === "agent-management"
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Scheduled Agents Management
          </button>
          <button
            type="button"
            onClick={() => setTab("memory")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === "memory"
                ? "border-primary text-primary"
                : "border-transparent text-on-surface-variant hover:text-on-surface"
            }`}
          >
            Memory Provider
          </button>
        </div>

        {tab === "dove" ? (
          <DoveDefinitionTab initialDove={effectiveDoveSettings(initialSettings)} />
        ) : tab === "repositories" ? (
          <RepoTable
            agentConfigs={agentConfigs}
            repositories={repositories}
            agentRepos={initialAgentRepos}
            onEdit={setEditingRepo}
            onRemove={handleRemoveRepo}
          />
        ) : tab === "env-vars" ? (
          <EnvVarTable envVars={envVars} onEdit={setEditingEnvVar} onRemove={handleRemoveEnvVar} />
        ) : tab === "memory" ? (
          <OpenVikingTab />
        ) : (
          <AgentManagementContent
            agents={scheduledAgentConfigs.map(buildAgentDef)}
            plugins={plugins}
          />
        )}
      </div>

      <EditRepoDialog
        repo={editingRepo}
        existingGithubRepos={repositories.map((r) => r.githubRepo)}
        onSave={handleEditRepo}
        onClose={() => setEditingRepo(null)}
      />
      <EditEnvVarDialog
        envVar={editingEnvVar}
        existingKeys={envVars.map((v) => v.key)}
        onSave={handleEditEnvVar}
        onClose={() => setEditingEnvVar(null)}
      />
    </div>
  );
}
