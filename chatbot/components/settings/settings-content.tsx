"use client";

import * as React from "react";
import { StatsCards } from "./stats-cards";
import { RepoTable } from "./repo-table";
import { AddRepoDialog } from "./add-repo-dialog";
import { EditRepoDialog } from "./edit-repo-dialog";
import { EnvVarTable } from "./env-var-table";
import { AddEnvVarDialog } from "./add-env-var-dialog";
import { EditEnvVarDialog } from "./edit-env-var-dialog";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { AgentManagementContent } from "./agent-management-content";
import { WS_PORT, statusMessageSchema } from "@/a2a/heartbeat-types";
import type { AgentStatus } from "@/a2a/heartbeat-types";
import { z } from "zod";
import {
  type GlobalSettings,
  type Repository,
  type EnvVar,
  globalSettingsSchema,
  envVarSchema,
} from "@@/lib/settings-schemas";

const envVarsResponseSchema = z.object({ envVars: z.array(envVarSchema) });

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
          if (typeof event.data !== "string") return;
          const result = statusMessageSchema.safeParse(JSON.parse(event.data));
          if (result.success) setStatuses(result.data.agents);
        } catch {
          // ignore malformed messages
        }
      });
      ws.addEventListener("close", () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
      ws.addEventListener("error", () => ws?.close());
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

type Tab = "repositories" | "env-vars" | "agent-management";

interface SettingsContentProps {
  initialSettings: GlobalSettings;
  initialAgentRepos: Record<string, string[]>;
}

export function SettingsContent({ initialSettings, initialAgentRepos }: SettingsContentProps) {
  const [tab, setTab] = React.useState<Tab>("repositories");
  const [repositories, setRepositories] = React.useState<Repository[]>(
    initialSettings.repositories,
  );
  const [editingRepo, setEditingRepo] = React.useState<Repository | null>(null);
  // Fetch env vars from API on mount so secrets have their real keychain values
  const [envVars, setEnvVars] = React.useState<EnvVar[]>(initialSettings.envVars);
  const [editingEnvVar, setEditingEnvVar] = React.useState<EnvVar | null>(null);
  const [saving, setSaving] = React.useState(false);
  const statuses = useAgentStatuses();

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
      <Breadcrumb items={[{ label: "Settings" }]} />

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
      <StatsCards repoCount={repositories.length} statuses={statuses} />

      {/* Tabs */}
      <div className="flex flex-col gap-4">
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
        </div>

        {tab === "repositories" ? (
          <RepoTable
            repositories={repositories}
            agentRepos={initialAgentRepos}
            onEdit={setEditingRepo}
            onRemove={handleRemoveRepo}
          />
        ) : tab === "env-vars" ? (
          <EnvVarTable envVars={envVars} onEdit={setEditingEnvVar} onRemove={handleRemoveEnvVar} />
        ) : (
          <AgentManagementContent />
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
