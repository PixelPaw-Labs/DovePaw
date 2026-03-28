"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";

interface AddRepoDialogProps {
  existingGithubRepos: string[];
  onAdd: (githubRepo: string) => void;
}

const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export function AddRepoDialog({ existingGithubRepos, onAdd }: AddRepoDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [githubRepo, setGithubRepo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = githubRepo.trim();

    if (!trimmed) {
      setError("GitHub repository cannot be empty");
      return;
    }
    if (!GITHUB_REPO_RE.test(trimmed)) {
      setError("Enter in owner/repo format, e.g. owner/repo-name");
      return;
    }
    if (existingGithubRepos.includes(trimmed)) {
      setError("This repository is already in the list");
      return;
    }

    onAdd(trimmed);
    reset();
    setOpen(false);
  }

  function reset() {
    setGithubRepo("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Add Repository
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Repository</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="repo-github" className="text-sm font-medium text-on-surface">
              GitHub repository
            </label>
            <Input
              id="repo-github"
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Add</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
