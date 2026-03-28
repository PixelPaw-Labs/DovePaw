"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Repository } from "@@/lib/settings-schemas";

interface EditRepoDialogProps {
  repo: Repository | null;
  existingGithubRepos: string[];
  onSave: (id: string, githubRepo: string, name: string) => void;
  onClose: () => void;
}

const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function EditRepoDialog({
  repo,
  existingGithubRepos,
  onSave,
  onClose,
}: EditRepoDialogProps) {
  const [githubRepo, setGithubRepo] = React.useState("");
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (repo) {
      setGithubRepo(repo.githubRepo);
      setName(repo.name);
      setError(null);
    }
  }, [repo]);

  const autoName = githubRepo.split("/").at(-1) ?? githubRepo;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!repo) return;

    const trimmedRepo = githubRepo.trim();
    const trimmedName = name.trim() || autoName;

    if (!trimmedRepo) {
      setError("GitHub repository cannot be empty");
      return;
    }
    if (!GITHUB_REPO_RE.test(trimmedRepo)) {
      setError("Enter in owner/repo format, e.g. owner/repo-name");
      return;
    }
    if (trimmedRepo !== repo.githubRepo && existingGithubRepos.includes(trimmedRepo)) {
      setError("This repository is already in the list");
      return;
    }

    onSave(repo.id, trimmedRepo, trimmedName);
    onClose();
  }

  return (
    <Dialog open={repo !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Repository</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-repo-github" className="text-sm font-medium text-on-surface">
              GitHub repository
            </label>
            <Input
              id="edit-repo-github"
              placeholder="owner/repo-name"
              value={githubRepo}
              onChange={(e) => {
                setGithubRepo(e.target.value);
                setError(null);
              }}
              autoFocus
              className="font-mono text-sm"
            />
            {error && <p className="text-xs text-error">{error}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-repo-name" className="text-sm font-medium text-on-surface">
              Display name
              <span className="ml-1.5 text-xs font-normal text-on-surface-variant">
                (optional — defaults to repo slug)
              </span>
            </label>
            <Input
              id="edit-repo-name"
              placeholder={autoName}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
