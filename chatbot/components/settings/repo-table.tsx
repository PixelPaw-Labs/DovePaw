import * as React from "react";
import Link from "next/link";
import { Trash2, FolderGit2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { Repository } from "@@/lib/settings-schemas";
import {
  DataTable,
  DataTableHeader,
  DataTableRow,
  DataTableEmpty,
  headerCellClass,
} from "./data-table";

interface RepoTableProps {
  agentConfigs: AgentConfigEntry[];
  repositories: Repository[];
  agentRepos: Record<string, string[]>;
  onEdit: (repo: Repository) => void;
  onRemove: (id: string) => void;
}

export function RepoTable({
  agentConfigs,
  repositories,
  agentRepos,
  onEdit,
  onRemove,
}: RepoTableProps) {
  const agents = agentConfigs.map(buildAgentDef);
  if (repositories.length === 0) {
    return (
      <DataTableEmpty
        icon={FolderGit2}
        title="No repositories configured"
        description="Add a repository to get started"
      />
    );
  }

  return (
    <DataTable cols="grid-cols-[1fr_2fr_auto_2rem_2rem]">
      <DataTableHeader>
        <span className={headerCellClass}>Name</span>
        <span className={headerCellClass}>GitHub</span>
        <span className={headerCellClass}>Agents</span>
        <span className="invisible" aria-hidden="true">
          Edit
        </span>
        <span className="invisible" aria-hidden="true">
          Delete
        </span>
      </DataTableHeader>

      {repositories.map((repo, i) => {
        const enabledAgents = agents.filter((a) => agentRepos[a.name]?.includes(repo.id) ?? false);

        return (
          <DataTableRow key={repo.id} isLast={i === repositories.length - 1}>
            <div className="flex items-center gap-2.5 min-w-0">
              <FolderGit2 className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm font-semibold text-on-surface truncate">{repo.name}</span>
            </div>
            <span className="text-xs font-mono text-on-surface-variant truncate">
              {repo.githubRepo}
            </span>

            {/* Agent icons */}
            <div className="flex items-center gap-1">
              {enabledAgents.length === 0 ? (
                <span className="text-xs text-on-surface-variant/40">—</span>
              ) : (
                enabledAgents.map((agent) => {
                  const Icon = agent.icon;
                  return (
                    <Tooltip key={agent.name}>
                      <TooltipTrigger asChild>
                        <Link
                          href={`/settings/agents/${agent.name}`}
                          className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0 hover:bg-primary/20 transition-colors"
                        >
                          <Icon className="w-3 h-3" />
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>{agent.displayName}</TooltipContent>
                    </Tooltip>
                  );
                })
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(repo)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high h-8 w-8 p-0"
              title={`Edit ${repo.name}`}
            >
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(repo.id)}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-error hover:bg-error-container/30 h-8 w-8 p-0"
              title={`Remove ${repo.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </DataTableRow>
        );
      })}
    </DataTable>
  );
}
