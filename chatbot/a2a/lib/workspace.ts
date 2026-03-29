import { execFile } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync } from "node:fs";
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
 *   {workspaceRoot}/{UUID}/
 *     └── source_{agentName}  ->  agentSourceDir  (symlink)
 *
 * @param agentName      kebab-case agent name, e.g. "get-shit-done"
 * @param agentSourceDir absolute path to the agent's source directory
 * @param workspaceRoot  optional override; defaults to ~/.dovepaw/workspaces/.{agentName}
 */
export function createAgentWorkspace(
  agentName: string,
  agentSourceDir: string,
  workspaceRoot?: string,
): AgentWorkspace {
  const root = workspaceRoot ?? agentWorkspaceDir(agentName);
  const uuid = randomUUID();
  const workspacePath = join(root, uuid);

  mkdirSync(workspacePath, { recursive: true });
  symlinkSync(agentSourceDir, join(workspacePath, `source_${agentName}`));

  return {
    path: workspacePath,
    cleanup() {
      try {
        rmSync(workspacePath, { recursive: true, force: true });
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
): Promise<string[]> {
  if (slugs.length === 0) return [];
  return Promise.all(
    slugs.map(async (slug) => {
      const repoName = slug.split("/").pop()!;
      const clonePath = join(workspacePath, repoName);
      await ghClone(slug, clonePath);
      return clonePath;
    }),
  );
}
