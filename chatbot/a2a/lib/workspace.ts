import { execFile } from "node:child_process";
import { mkdirSync, rmdirSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { AGENTS_ROOT, agentWorkspaceDir } from "@@/lib/paths";

export interface AgentWorkspace {
  /** Absolute path to the UUID workspace directory. */
  path: string;
  /** Remove the workspace directory. Best-effort — never throws. */
  cleanup(): void;
}

/**
 * Create an isolated workspace directory for a single agent script execution.
 *
 * Structure:
 *   {workspaceRoot}/{alias}-{shortId}/
 *     └── source_{alias}  ->  agentSourceDir  (symlink)
 *
 * @param agentName      kebab-case agent name, e.g. "get-shit-done" — used for the parent dir
 * @param alias          short alias, e.g. "gsd" — used as the workspace folder prefix
 * @param agentSourceDir absolute path to the agent's source directory
 * @param workspaceRoot  optional override; defaults to ~/.dovepaw/workspaces/.{agentName}
 */
export function createAgentWorkspace(
  agentName: string,
  alias: string,
  agentSourceDir: string,
  workspaceRoot?: string,
  taskId?: string,
  onProgress?: (message: string, artifacts: Record<string, string>) => void,
): AgentWorkspace {
  const root = workspaceRoot ?? agentWorkspaceDir(agentName);
  const shortId = taskId
    ? taskId.replace(/-/g, "").slice(0, 8)
    : randomUUID().replace(/-/g, "").slice(0, 8);
  const workspacePath = join(root, `${alias}-${shortId}`);

  mkdirSync(workspacePath, { recursive: true });
  onProgress?.(`Creating workspace`, { workspace: workspacePath });
  symlinkSync(agentSourceDir, join(workspacePath, `source_${alias}`));
  onProgress?.(`Linked source`, { source: agentSourceDir });

  return {
    path: workspacePath,
    cleanup() {
      try {
        rmSync(workspacePath, { recursive: true, force: true });
      } catch {
        // best effort — do not propagate
      }
      try {
        rmdirSync(root); // removes parent only if empty; throws ENOTEMPTY or ENOENT otherwise
      } catch {
        // best effort — do not propagate
      }
    },
  };
}

/**
 * Derive the agent source directory from an entryPath (relative to AGENTS_ROOT).
 * e.g. "agents/get-shit-done/main.ts" → "{AGENTS_ROOT}/agents/get-shit-done"
 */
export function agentSourceDirFromEntry(entryPath: string): string {
  return join(AGENTS_ROOT, dirname(entryPath));
}

/**
 * Clone a list of GitHub repo slugs into the workspace using the gh CLI.
 * Each slug (e.g. "org/my-app") is cloned to
 * "{workspacePath}/my-app".
 *
 * Clones run in parallel. Returns the list of local clone paths in the same
 * order as the input slugs.
 *
 * @throws if gh exits non-zero for any repo
 */
/** Signature for the function that performs the actual gh clone. Injectable for testing. */
export type GhCloneFn = (slug: string, clonePath: string) => Promise<void>;

function defaultGhClone(slug: string, clonePath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile("gh", ["repo", "clone", slug, clonePath], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Clone a list of GitHub repo slugs into the workspace using the gh CLI.
 * Each slug (e.g. "org/my-app") is cloned to
 * "{workspacePath}/my-app".
 *
 * Clones run in parallel. Returns the list of local clone paths in the same
 * order as the input slugs.
 *
 * @throws if gh exits non-zero for any repo
 */
export async function cloneReposIntoWorkspace(
  workspacePath: string,
  slugs: string[],
  ghClone: GhCloneFn = defaultGhClone,
  onProgress?: (slug: string) => void,
): Promise<string[]> {
  if (slugs.length === 0) return [];
  return Promise.all(
    slugs.map(async (slug) => {
      const repoName = slug.split("/").pop()!;
      const clonePath = join(workspacePath, repoName);
      onProgress?.(slug);
      await ghClone(slug, clonePath);
      return clonePath;
    }),
  );
}

/**
 * Delete any existing clone dirs for the given slugs, then clone fresh.
 *
 * Used by start_run_script so that re-invocations always start from a clean
 * workspace state rather than failing because the clone dir already exists.
 */
export async function recloneReposIntoWorkspace(
  workspacePath: string,
  slugs: string[],
  ghClone: GhCloneFn = defaultGhClone,
  onProgress?: (slug: string) => void,
): Promise<string[]> {
  for (const slug of slugs) {
    const repoName = slug.split("/").pop()!;
    const clonePath = join(workspacePath, repoName);
    if (existsSync(clonePath)) {
      rmSync(clonePath, { recursive: true, force: true });
    }
  }
  return cloneReposIntoWorkspace(workspacePath, slugs, ghClone, onProgress);
}
