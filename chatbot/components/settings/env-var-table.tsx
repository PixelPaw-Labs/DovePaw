import * as React from "react";
import { Trash2, KeyRound, Lock, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EnvVar } from "@@/lib/settings-schemas";
import {
  DataTable,
  DataTableHeader,
  DataTableRow,
  DataTableEmpty,
  headerCellClass,
} from "./data-table";

interface EnvVarTableProps {
  envVars: EnvVar[];
  onEdit: (envVar: EnvVar) => void;
  onRemove: (id: string) => void;
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
  if (!isSecret) {
    return <span className="text-xs font-mono text-on-surface-variant truncate">{value}</span>;
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-xs font-mono text-on-surface-variant truncate">{"•".repeat(8)}</span>
      <span className="shrink-0 text-[10px] font-medium text-primary/70 bg-primary/10 rounded px-1 py-0.5 leading-none">
        {keychainService ? `${keychainService} / ${keychainAccount ?? ""}` : "keychain"}
      </span>
    </div>
  );
}

export function EnvVarTable({ envVars, onEdit, onRemove }: EnvVarTableProps) {
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  if (envVars.length === 0) {
    return (
      <DataTableEmpty
        icon={KeyRound}
        title="No environment variables configured"
        description="Add a variable to get started"
      />
    );
  }

  return (
    <DataTable cols="grid-cols-[1fr_2fr_5rem]">
      <DataTableHeader>
        <span className={headerCellClass}>Key</span>
        <span className={headerCellClass}>Value</span>
        <span className="invisible" aria-hidden="true">
          Actions
        </span>
      </DataTableHeader>

      {envVars.map((envVar, i) => (
        <DataTableRow key={envVar.id} isLast={i === envVars.length - 1}>
          {deletingId === envVar.id ? (
            <div className="col-span-full flex items-center gap-3 py-1">
              <span className="text-xs text-destructive font-medium ml-auto">
                Delete &ldquo;{envVar.key}&rdquo;?
              </span>
              <button
                type="button"
                onClick={() => {
                  onRemove(envVar.id);
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
                {envVar.isSecret ? (
                  <Lock className="w-4 h-4 text-primary shrink-0" />
                ) : (
                  <KeyRound className="w-4 h-4 text-primary shrink-0" />
                )}
                <span className="text-sm font-mono font-semibold text-on-surface truncate">
                  {envVar.key}
                </span>
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
                  onClick={() => onEdit(envVar)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high h-8 w-8 p-0"
                  title={`Edit ${envVar.key}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeletingId(envVar.id)}
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
    </DataTable>
  );
}
