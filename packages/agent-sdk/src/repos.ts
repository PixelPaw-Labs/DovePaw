import { execFileSync } from "node:child_process";
import { join, basename } from "node:path";

const HOME = process.env.HOME!;

/**
 * Parse a comma-separated env var of repo paths.
 * Paths can be absolute or relative to $HOME.
 */
export function parseRepos(envVar: string): string[] {
  return (process.env[envVar] || "")
    .split(",")
    .filter(Boolean)
    .map((r) => (r.startsWith("/") ? r : join(HOME, r)));
}

/**
 * Ensure all base repos are checked out on main.
 * Must run at the start of each scheduler invocation so that
 * forge worktrees (created via -w from repo HEAD) always start from main.
 */
export function resetReposToMain(baseRepos: string[], log: (msg: string) => void): void {
  for (const repo of baseRepos) {
    try {
      execFileSync("git", ["checkout", "."], { cwd: repo, stdio: "ignore" });
      execFileSync("git", ["checkout", "main"], { cwd: repo, stdio: "ignore" });
      execFileSync("git", ["pull", "origin", "main"], { cwd: repo, stdio: "ignore" });
    } catch {
      log(`WARN: could not reset to main in ${repo}`);
    }
  }
}

export function repoToSlug(path: string): string {
  return path.replace(/[/._\s]/g, "-");
}

/**
 * Resolve a repo basename to its absolute path from the known repo list.
 */
export function resolveRepoName(name: string, baseRepos: string[]): string | null {
  if (!name) return null;
  const lower = name.toLowerCase();
  return baseRepos.find((r) => basename(r).toLowerCase() === lower) ?? null;
}
