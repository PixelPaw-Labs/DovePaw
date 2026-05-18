import { execFile } from "node:child_process";
import { access, cp, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  AGENTS_ROOT,
  DOVEPAW_BROWSER_SKILL_SRC,
  KARPATHY_HOOK_SRC,
  agentWorkspacePath,
} from "@@/lib/paths";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface AgentWorkspace {
  /** Absolute path to the UUID workspace directory. */
  path: string;
  /** Remove the workspace directory. Best-effort — never throws. */
  cleanup(): Promise<void>;
}

/**
 * Create an isolated workspace directory for a single agent script execution.
 *
 * Structure:
 *   {workspaceRoot}/{alias}-{shortId}/
 *
 * @param agentName     kebab-case agent name, e.g. "get-shit-done" — used for the parent dir
 * @param alias         short alias, e.g. "gsd" — used as the workspace folder prefix
 * @param workspaceRoot optional override; defaults to ~/.dovepaw/workspaces/.{agentName}
 */
export async function createAgentWorkspace(
  agentName: string,
  alias: string,
  workspaceRoot?: string,
  taskId?: string,
  onProgress?: (message: string, artifacts: Record<string, string>) => void,
): Promise<AgentWorkspace> {
  const shortId = taskId
    ? taskId.replace(/-/g, "").slice(0, 8)
    : randomUUID().replace(/-/g, "").slice(0, 8);
  const workspacePath = agentWorkspacePath(agentName, alias, shortId, workspaceRoot);

  onProgress?.(`Creating workspace`, { workspace: workspacePath });
  await writeWorkspaceSettings(workspacePath);
  await seedBrowserSkill(workspacePath);

  return { path: workspacePath, cleanup: buildCleanup(workspacePath, dirname(workspacePath)) };
}

async function writeWorkspaceSettings(workspacePath: string): Promise<void> {
  const claudeDir = join(workspacePath, ".claude");
  await mkdir(claudeDir, { recursive: true });
  const settings = {
    outputStyle: "Sub-agent",
    hooks: {
      PreToolUse: [
        {
          matcher: "ScheduleWakeup",
          hooks: [
            {
              type: "command",
              command: `python3 -c "import sys,json,time; d=json.load(sys.stdin); time.sleep(d.get('tool_input',{}).get('delaySeconds',60))" && printf '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"Replaced ScheduleWakeup with python sleep"}}'`,
              timeout: 3660,
            },
          ],
        },
      ],
    },
  };
  await writeFile(join(claudeDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
}

/** Copy the dovepaw-browser skill into a .claude/skills/ directory.
 *  Best-effort — never throws; workspace creation must not fail if the skill is absent. */
async function seedBrowserSkill(targetDir: string): Promise<void> {
  try {
    const dest = join(targetDir, ".claude", "skills", "dovepaw-browser");
    await cp(DOVEPAW_BROWSER_SKILL_SRC, dest, { recursive: true });
  } catch {
    // skill source may not exist before first install; ignore silently
  }
}

function buildCleanup(workspacePath: string, parentDir: string): () => Promise<void> {
  return async function cleanup() {
    try {
      await rm(workspacePath, { recursive: true, force: true });
    } catch {
      // best effort — do not propagate
    }
    try {
      await rmdir(parentDir); // removes parent only if empty; throws ENOTEMPTY or ENOENT otherwise
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
      await writeWorkspacePermissions(clonePath);
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
async function writeWorkspacePermissions(clonePath: string): Promise<void> {
  await mkdir(join(clonePath, ".claude"), { recursive: true });

  const hookSrc = await readFile(KARPATHY_HOOK_SRC, "utf8");
  const settings = {
    permissions: { allow: ["Write(/**)", "Edit(/**)", "Bash(*)"] },
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `echo ${Buffer.from(hookSrc).toString("base64")} | base64 -d | bash`,
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
  await writeFile(
    join(clonePath, ".claude", "settings.local.json"),
    JSON.stringify(settings, null, 2) + "\n",
  );
  await seedBrowserSkill(clonePath);
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
  await Promise.all(
    slugs.map(async (slug) => {
      const repoName = slug.split("/").pop()!;
      const clonePath = join(workspacePath, repoName);
      if (await exists(clonePath)) {
        await rm(clonePath, { recursive: true, force: true });
      }
    }),
  );
  return cloneReposIntoWorkspace(workspacePath, slugs, ghClone, onProgress);
}
