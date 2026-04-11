import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "./exec.js";

/**
 * Fixed branch created once per repo during workspace setup.
 * All worktree branches are forked from this branch.
 */
export const WORKSPACE_BASE_BRANCH = "dovepaw-base";

/**
 * Ensure the workspace base branch exists, contains the given patterns in both
 * .gitignore and .worktreeinclude, and HEAD is on it.
 *
 * - If absent: creates from main, writes patterns, commits, stays on branch.
 * - If present: checks it out (idempotent — patterns already committed).
 */
export async function ensureBaseBranch(repoPath: string, patterns: string[]): Promise<void> {
  const exists = await exec("git", ["rev-parse", "--verify", WORKSPACE_BASE_BRANCH], {
    cwd: repoPath,
  });
  if (exists.ok) {
    await exec("git", ["checkout", WORKSPACE_BASE_BRANCH], { cwd: repoPath });
    return;
  }
  await exec("git", ["checkout", "-b", WORKSPACE_BASE_BRANCH, "main"], { cwd: repoPath });
  appendPatterns(repoPath, ".gitignore", patterns);
  writeFileSync(join(repoPath, ".worktreeinclude"), patterns.join("\n") + "\n");
  await commitFiles(
    repoPath,
    [".gitignore", ".worktreeinclude"],
    "chore: configure workspace patterns",
  );
}

/**
 * Stage and commit specific files in a repo if they have uncommitted changes.
 * Never pushes — local commit only.
 */
export async function commitFiles(
  repoPath: string,
  files: string[],
  message: string,
): Promise<void> {
  await exec("git", ["add", ...files], { cwd: repoPath });
  const status = await exec("git", ["diff", "--cached", "--quiet"], { cwd: repoPath });
  if (status.ok) return; // nothing staged — no changes
  await exec("git", ["commit", "-m", message], { cwd: repoPath });
}

/**
 * Create a feature branch from main, commit specific files to it, and stay on it.
 * claude -w will then create the worktree branch from this HEAD.
 * Never pushes — local commit only.
 */
export async function createFeatureBranch(
  repoPath: string,
  branch: string,
  files: string[],
  message: string,
): Promise<void> {
  await exec("git", ["checkout", "-b", branch, "main"], { cwd: repoPath });
  await commitFiles(repoPath, files, message);
}

/** Append patterns to a repo's .gitignore, skipping any that already exist. */
function appendPatterns(repoPath: string, filename: string, patterns: string[]): void {
  const filePath = join(repoPath, filename);
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  const lines = new Set(existing.split("\n").map((l) => l.trim()));
  const toAdd = patterns.filter((p) => !lines.has(p));
  if (toAdd.length === 0) return;
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(filePath, existing + separator + toAdd.join("\n") + "\n");
}
