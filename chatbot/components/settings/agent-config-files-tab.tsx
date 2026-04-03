"use client";

import * as React from "react";
import { FileJson, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { z } from "zod";
import { DataTableEmpty } from "./data-table";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";

const configFileSchema = z.object({ name: z.string(), content: z.string() });
const configFilesResponseSchema = z.object({ files: z.array(configFileSchema) });

type ConfigFile = z.infer<typeof configFileSchema>;

interface DialogState {
  mode: "add" | "edit";
  file: ConfigFile;
}

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/;

function previewContent(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
}

export function AgentConfigFilesTab({ agentName }: { agentName: string }) {
  const [files, setFiles] = React.useState<ConfigFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editContent, setEditContent] = React.useState("{}");
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deletingName, setDeletingName] = React.useState<string | null>(null);

  React.useEffect(() => {
    void fetchFiles();
  }, [agentName]);

  async function fetchFiles() {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/settings/agent-config-files?agentName=${encodeURIComponent(agentName)}`,
      );
      if (res.ok) {
        const data = configFilesResponseSchema.parse(await res.json());
        setFiles(data.files);
      }
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditName("");
    setEditContent("{}");
    setNameError(null);
    setJsonError(null);
    setDialog({ mode: "add", file: { name: "", content: "{}" } });
  }

  function openEdit(file: ConfigFile) {
    setEditName(file.name);
    setEditContent(file.content);
    setNameError(null);
    setJsonError(null);
    setDialog({ mode: "edit", file });
  }

  function closeDialog() {
    setDialog(null);
    setNameError(null);
    setJsonError(null);
  }

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault();
    const name = editName.trim();

    if (!name) {
      setNameError("Filename is required");
      return;
    }
    if (!FILENAME_RE.test(name)) {
      setNameError("Must be alphanumeric with dashes/underscores, ending in .json");
      return;
    }
    if (dialog?.mode === "add" && files.some((f) => f.name === name)) {
      setNameError(`"${name}" already exists`);
      return;
    }

    try {
      JSON.parse(editContent);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/settings/agent-config-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, filename: name, content: editContent }),
      });
      if (res.ok) {
        const data = configFilesResponseSchema.parse(await res.json());
        setFiles(data.files);
        closeDialog();
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(filename: string) {
    const res = await fetch("/api/settings/agent-config-files", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentName, filename }),
    });
    if (res.ok) {
      const data = configFilesResponseSchema.parse(await res.json());
      setFiles(data.files);
    }
    setDeletingName(null);
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
          Config Files
        </h3>
        <div className="flex-1 h-px bg-outline-variant/20" />
        <Button size="sm" className="gap-2" onClick={openAdd}>
          <Plus className="w-4 h-4" />
          New File
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-on-surface-variant text-sm">
          Loading…
        </div>
      ) : files.length === 0 ? (
        <DataTableEmpty
          icon={FileJson}
          title="No config files"
          description="Add JSON config files that this agent can read at runtime"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {files.map((file) => (
            <div
              key={file.name}
              className="bg-surface-container-lowest rounded-xl shadow-[0_4px_16px_-4px_rgba(43,52,55,0.08)] flex items-center justify-between px-6 py-5 group"
            >
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-10 h-10 rounded-full bg-surface-container flex items-center justify-center text-primary shrink-0">
                  <FileJson className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-semibold text-on-surface text-sm font-mono">{file.name}</h4>
                  <p className="text-xs text-on-surface-variant mt-0.5 font-mono truncate max-w-sm">
                    {previewContent(file.content)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {deletingName === file.name ? (
                  <>
                    <span className="text-xs text-destructive font-medium mr-1">Delete?</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(file.name)}
                      className="h-8 px-2 text-xs font-bold text-destructive-foreground bg-destructive hover:brightness-110"
                    >
                      Confirm
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingName(null)}
                      className="h-8 px-2 text-xs font-bold bg-secondary border border-border text-foreground hover:brightness-95"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(file)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high h-8 w-8 p-0"
                      title={`Edit ${file.name}`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingName(file.name)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-on-surface-variant hover:text-error hover:bg-error-container/30 h-8 w-8 p-0"
                      title={`Delete ${file.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent
          className="sm:max-w-none"
          style={{ width: "fit-content", maxWidth: "90vw", overflow: "visible" }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "add" ? "New Config File" : `Edit ${dialog?.file.name}`}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSave} className="flex flex-col gap-4">
            {dialog?.mode === "add" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="cfg-filename" className="text-sm font-medium text-on-surface">
                  Filename
                </label>
                <Input
                  id="cfg-filename"
                  placeholder="bootstrap-services.json"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setNameError(null);
                  }}
                  autoFocus
                  className="font-mono text-sm"
                />
                {nameError && <p className="text-xs text-error">{nameError}</p>}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-on-surface">JSON Content</label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-on-surface-variant hover:text-on-surface"
                  onClick={() => {
                    try {
                      setEditContent(JSON.stringify(JSON.parse(editContent), null, 2));
                      setJsonError(null);
                    } catch (err) {
                      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
                    }
                  }}
                >
                  Format
                </Button>
              </div>
              <div
                className="rounded-lg border border-input overflow-hidden text-sm"
                style={{ resize: "both", width: 560, minWidth: 400, height: 320, minHeight: 160 }}
              >
                <CodeMirror
                  value={editContent}
                  extensions={[json(), EditorView.theme({ ".cm-scroller": { overflow: "auto" } })]}
                  width="100%"
                  height="100%"
                  onChange={(value) => {
                    setEditContent(value);
                    setJsonError(null);
                  }}
                  basicSetup={{ lineNumbers: true, foldGutter: true }}
                />
              </div>
              {jsonError && <p className="text-xs text-error">{jsonError}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeDialog}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
