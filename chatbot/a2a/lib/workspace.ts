import { execFile } from "node:child_process";
import {
  mkdirSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  existsSync,
  lstatSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AGENTS_ROOT,
  KARPATHY_HOOK_SRC,
  workspaceKarpathyHook,
  agentConfigDir,
  agentWorkspaceDir,
} from "@@/lib/paths";

export interface AgentWorkspace {
  /** Absolute path to the UUID workspace directory. */
  path: string;
  /** Remove the workspace directory. Best-effort — never throws. */
  cleanup(): void;
}

/**
 * Ensure a `source` symlink exists inside the agent's persistent config
 * directory, pointing at the agent's TypeScript source directory.
 *
 *   ~/.dovepaw/settings.agents/{agentName}/source  ->  agentSourceDir
 *
 * Idempotent — skips creation if the symlink already points at the correct target.
 * Recreates the symlink if it exists but points elsewhere (e.g. after a repo move).
 */
export function ensureAgentSourceSymlink(
  agentName: string,
  agentSourceDir: string,
  onProgress?: (message: string, artifacts: Record<string, string>) => void,
): void {
  const configDir = agentConfigDir(agentName);
  mkdirSync(configDir, { recursive: true });
  const symlinkPath = join(configDir, `source`);
  if (existsSync(symlinkPath) || lstatSync(symlinkPath, { throwIfNoEntry: false })) {
    // Already exists (or is a broken symlink or a leftover directory) — remove so
    // we can recreate if stale. Use recursive:true so a plain directory is also
    // handled (rmSync without recursive silently swallows EISDIR when force:true,
    // leaving the path in place and causing symlinkSync to throw EEXIST).
    try {
      rmSync(symlinkPath, { force: true, recursive: true });
    } catch {
      // best effort
    }
  }
  symlinkSync(agentSourceDir, symlinkPath);
  onProgress?.("Linked source", { source: agentSourceDir });
}

/**
 * Create an isolated workspace directory for a single agent script execution.
 *
 * Structure:
 *   {workspaceRoot}/{alias}-{shortId}/
 *
 * The agent source is accessible via the persistent symlink created by
 * `ensureAgentSourceSymlink` inside the agent's config directory — call that
 * before creating the workspace.
 *
 * @param agentName     kebab-case agent name, e.g. "get-shit-done" — used for the parent dir
 * @param alias         short alias, e.g. "gsd" — used as the workspace folder prefix
 * @param workspaceRoot optional override; defaults to ~/.dovepaw/workspaces/.{agentName}
 */
export function createAgentWorkspace(
  agentName: string,
  alias: string,
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

  return { path: workspacePath, cleanup: buildCleanup(workspacePath, root) };
}

function buildCleanup(workspacePath: string, parentDir: string): () => void {
  return function cleanup() {
    try {
      rmSync(workspacePath, { recursive: true, force: true });
    } catch {
      // best effort — do not propagate
    }
    try {
      rmdirSync(parentDir); // removes parent only if empty; throws ENOTEMPTY or ENOENT otherwise
    } catch {
      // best effort — do not propagate
    }
  };
}

/**
 * Wrap an existing workspace directory as an AgentWorkspace.
 * Used when restoring a session from the DB — the directory already exists,
 * so no mkdir is needed. Cleanup behaviour is identical to a freshly created workspace.
 */
export function restoreAgentWorkspace(workspacePath: string): AgentWorkspace {
  return { path: workspacePath, cleanup: buildCleanup(workspacePath, dirname(workspacePath)) };
}

/**
 * Derive the agent source directory from an entryPath.
 * e.g. "agents/get-shit-done/main.ts" → "{scriptRoot}/agents/get-shit-done"
 *
 * @param entryPath  Path relative to scriptRoot (core agents) or absolute (plugin agents)
 * @param scriptRoot Root directory to resolve relative paths against. Defaults to AGENTS_ROOT.
 */
export function agentSourceDirFromEntry(
  entryPath: string,
  scriptRoot: string = AGENTS_ROOT,
): string {
  return join(scriptRoot, dirname(entryPath));
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
      writeWorkspacePermissions(clonePath);
      return clonePath;
    }),
  );
}

/**
 * Write .claude/settings.local.json inside a cloned repo to grant Write
 * permission to the entire workspace directory. This allows Claude Code
 * sub-processes running inside the repo to write files under the workspace
 * (e.g. per-ticket skill and reference files) without triggering permission prompts.
 *
 * The PermissionRequest hook is required to bypass the .claude/ self-edit
 * protection, which is a hardcoded layer that runs after all other permission
 * checks (flags, allow-lists, PreToolUse hooks) and cannot be bypassed by them.
 * See: https://github.com/anthropics/claude-code/issues/37765
 */
function writeWorkspacePermissions(clonePath: string): void {
  mkdirSync(join(clonePath, ".claude"), { recursive: true });

  const dest = workspaceKarpathyHook(clonePath);
  copyFileSync(KARPATHY_HOOK_SRC, dest);
  chmodSync(dest, 0o755);

  const settings = {
    permissions: { allow: ["Write(/**)", "Edit(/**)", "Bash(*)"] },
    hooks: {
      PreToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [
            {
              type: "command",
              command: "bash .claude/karpathy-guidelines.sh",
              timeout: 10,
            },
          ],
        },
      ],
      PermissionRequest: [
        {
          matcher: "Edit|Write",
          hooks: [
            {
              type: "command",
              command:
                'printf \'{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}\'',
              timeout: 5,
            },
          ],
        },
      ],
    },
  };
  writeFileSync(
    join(clonePath, ".claude", "settings.local.json"),
    JSON.stringify(settings, null, 2) + "\n",
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
