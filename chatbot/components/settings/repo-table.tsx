import * as React from "react";
import Link from "next/link";
import { ChevronDown, Trash2, FolderGit2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import type { Repository } from "@@/lib/settings-schemas";
import { groupReposByOwner } from "@/lib/group-repos-by-owner";
import { useCollapsedSet } from "@/components/hooks/use-collapsed-set";
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
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const agents = agentConfigs.map(buildAgentDef);
  const ownerGroups = groupReposByOwner(repositories);
  const { isCollapsed, toggle } = useCollapsedSet();
  const visibleRepos = ownerGroups.flatMap((g) => (isCollapsed(g.owner) ? [] : g.repos));
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
    <DataTable cols="grid-cols-[1fr_2fr_auto_5rem]">
      <DataTableHeader>
        <span className={headerCellClass}>Name</span>
        <span className={headerCellClass}>GitHub</span>
        <span className={headerCellClass}>Agents</span>
        <span className="invisible" aria-hidden="true">
          Actions
        </span>
      </DataTableHeader>

      {ownerGroups.flatMap((group) => {
        const collapsed = isCollapsed(group.owner);
        const ownerLabel = group.owner || "(no owner)";
        const header = (
          <DataTableRow key={`owner-${ownerLabel}`} isLast={false}>
            <button
              type="button"
              onClick={() => toggle(group.owner)}
              aria-expanded={!collapsed}
              aria-controls={`owner-section-${ownerLabel}`}
              className="col-span-full flex items-center gap-2 pt-3 pb-1 text-left text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform ${collapsed ? "-rotate-90" : ""}`}
              />
              {ownerLabel}
              <span className="ml-1 opacity-50">({group.repos.length})</span>
            </button>
          </DataTableRow>
        );
        if (collapsed) return [header];
        return [header].concat(
          group.repos.map((repo) => {
            const enabledAgents = agents.filter(
              (a) => agentRepos[a.name]?.includes(repo.id) ?? false,
            );
            const isLast = visibleRepos[visibleRepos.length - 1]?.id === repo.id;
            return (
              <DataTableRow key={repo.id} isLast={isLast}>
                {deletingId === repo.id ? (
                  <div className="col-span-full flex items-center gap-3 py-1">
                    <span className="text-xs text-destructive font-medium ml-auto">
                      Delete &ldquo;{repo.name}&rdquo;?
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onRemove(repo.id);
                        setDeletingId(null);
                      }}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-destructive text-destructive-foreground hover:brightness-110"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingId(null)}
                      className="rounded-lg px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide bg-secondary border border-border text-foreground hover:brightness-95"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FolderGit2 className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-sm font-semibold text-foreground truncate">
                        {repo.name}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground truncate">
                      {repo.githubRepo}
                    </span>

                    <div className="flex items-center gap-1">
                      {enabledAgents.length === 0 ? (
                        <span className="text-xs text-muted-foreground/40">—</span>
                      ) : (
                        enabledAgents.map((agent) => {
                          const Icon = agent.icon;
                          return (
                            <Tooltip key={agent.name}>
                              <TooltipTrigger asChild>
                                <Link
                                  href={`/settings/agents/${agent.name}`}
                                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity ${agent.iconBg} ${agent.iconColor}`}
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

                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(repo)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground hover:bg-muted-high h-8 w-8 p-0"
                        title={`Edit ${repo.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingId(repo.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-error hover:bg-error-container/30 h-8 w-8 p-0"
                        title={`Remove ${repo.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </DataTableRow>
            );
          }),
        );
      })}
    </DataTable>
  );
}
