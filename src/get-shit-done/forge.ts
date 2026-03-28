import { rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeRunner, LogFn } from "./claude-runner.js";
import type { JiraClient } from "./jira.js";
import { parseJson } from "../lib/json.js";
import { ticketKeys, type TicketAssignment, type RepoAssignment } from "./prioritizer.js";
import { type ForgeResult, type WorktreeInfo, worktreePath, buildForgePrompt } from "./prompts.js";

interface ForgeOutput {
  affected_urls?: string[];
}

// ─── ForgeService deps ──────────────────────────────────────────────────────

export interface ForgeServiceDeps {
  runner: ClaudeRunner;
  jira: JiraClient;
  log: LogFn;
}

// ─── ForgeService class ─────────────────────────────────────────────────────

export class ForgeService {
  private readonly runner: ClaudeRunner;
  private readonly jira: JiraClient;
  private readonly log: LogFn;

  constructor(deps: ForgeServiceDeps) {
    this.runner = deps.runner;
    this.jira = deps.jira;
    this.log = deps.log;
  }

  private async forgeInRepo(
    ticketKey: string,
    ticketUrl: string,
    assignment: RepoAssignment,
    devServerInfo: string,
    complexity: TicketAssignment["complexity"],
  ): Promise<{ ok: boolean; wt: WorktreeInfo | null; affectedUrls: string[] }> {
    this.log(`  FORGING ${ticketKey} in ${assignment.repoPath} (worktree: ${assignment.branch})`);

    const { code, stdout } = await this.runner.run(
      buildForgePrompt(ticketKey, ticketUrl, devServerInfo, complexity),
      {
        cwd: assignment.repoPath,
        worktree: assignment.branch,
        taskName: `get-shit-done: forge ${ticketKey} in ${assignment.repoPath}`,
        model: "opus",
        effort: "low",
      },
    );

    this.runner.writeLog("task", `${ticketKey}-${assignment.branch}`, stdout);
    this.cleanupSkillDir(ticketKey);

    if (code !== 0) {
      this.log(`  FORGE FAILED: ${ticketKey} in ${assignment.repoPath} (exit code: ${code})`);
      return { ok: false, wt: null, affectedUrls: [] };
    }

    const parsed = parseJson(stdout, ForgeService.isForgeOutput);
    const affectedUrls = parsed?.affected_urls ?? [];

    return {
      ok: true,
      wt: {
        repoPath: assignment.repoPath,
        worktreePath: worktreePath(assignment.repoPath, assignment.branch),
      },
      affectedUrls,
    };
  }

  async forgeTicket(ticket: TicketAssignment, devServerInfo: string): Promise<ForgeResult> {
    if (ticket.repos.length === 0) {
      throw new Error(
        `No repo assignments for ${ticket.key} — prioritizer must provide at least one`,
      );
    }
    for (const r of ticket.repos) {
      if (!r.branch) throw new Error(`No branch name for ${ticket.key} in ${r.repoPath}`);
    }

    const ticketUrl = this.jira.ticketUrl(ticket.key);
    this.log(`FORGING: ${ticket.key} -> ${ticketUrl} (${ticket.repos.length} repo(s))`);

    const [results] = await Promise.all([
      Promise.all(
        ticket.repos.map((r) =>
          this.forgeInRepo(ticket.key, ticketUrl, r, devServerInfo, ticket.complexity),
        ),
      ),
      this.jira.moveTicket(ticket.key, "In Progress").then((ok) => {
        if (!ok) this.log(`WARN: Could not move ${ticket.key} to In Progress`);
      }),
    ]);

    const worktrees: WorktreeInfo[] = results.flatMap((r) => (r.wt ? [r.wt] : []));
    const affectedUrls: string[] = results.flatMap((r) => r.affectedUrls);
    const allOk = results.every((r) => r.ok);
    const noneOk = worktrees.length === 0;

    if (noneOk) {
      this.log(`FORGE FAILED: ${ticket.key}`);
      return { ticketKey: ticket.key, status: "failed", worktrees: [], affectedUrls: [] };
    }

    const status = allOk ? "success" : "partial";
    this.log(`FORGED (${status}): ${ticket.key}`);
    return { ticketKey: ticket.key, status, worktrees, affectedUrls };
  }

  private cleanupSkillDir(ticketKey: string): void {
    const dir = join(homedir(), ".claude", "skills", ticketKey);
    if (!existsSync(dir)) return;
    try {
      rmSync(dir, { recursive: true, force: true });
      this.log(`CLEANUP: removed dynamic skill dir ${dir}`);
    } catch (err) {
      this.log(
        `CLEANUP WARN: failed to remove ${dir}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private static isForgeOutput(v: unknown): v is ForgeOutput {
    return typeof v === "object" && v !== null;
  }

  async forgeGroup(group: TicketAssignment[], devServerInfo: string): Promise<ForgeResult[]> {
    this.log(`FORGING GROUP: ${ticketKeys(group).join(", ")}`);
    const results = await Promise.allSettled(group.map((t) => this.forgeTicket(t, devServerInfo)));

    return results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            ticketKey: group[i].key,
            status: "failed",
            worktrees: [],
            affectedUrls: [],
          },
    );
  }
}
