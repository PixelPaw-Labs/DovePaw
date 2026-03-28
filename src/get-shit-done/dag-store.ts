/**
 * DagStore — persists sprint ticket DAG state in LadybugDB.
 *
 * Replaces run-state.json with a proper property graph:
 *   TicketGroup nodes  — one per ticket group (primary key = first ticket)
 *   DependsOn edges    — directed dependency between groups
 *   ExtraCompleted nodes — individual tickets marked done outside group flow
 *
 * Key improvement over the JSON approach: buildGuidance() emits a natural-language
 * DAG description for the LLM re-prioritization hint, instead of re-injecting
 * the raw LLM JSON output blob.
 *
 * Note: "Group" is a reserved keyword in LadybugDB — the table is named "TicketGroup".
 */

import lbug from "@ladybugdb/core";
import type { Database, Connection, QueryResult, LbugValue } from "@ladybugdb/core";
import { execFileSync } from "node:child_process";
import type { GroupStates } from "./dag.js";
import { primaryKey } from "./dag.js";
import type { PrioritizeResult } from "./prioritizer.js";
import { ticketKeys } from "./prioritizer.js";

// Runtime constructors come from the default export; type-only imports above handle typing.
const { Database: DbClass, Connection: ConnClass } = lbug;

// Buffer pool: 128 MB — sufficient for sprint-sized graphs (5–50 nodes)
const BUFFER_POOL_BYTES = 128 * 1024 * 1024;

// Table and relationship names — centralised to avoid scattered string literals.
// Note: "Group" is a reserved keyword in LadybugDB, hence "TicketGroup".
const T_GROUP = "TicketGroup";
const T_EXTRA = "ExtraCompleted";
const T_WAITING = "WaitingTicket";
const R_DEP = "DependsOn";

/** How long to suppress the prioritizer after an all-blocked result (30 minutes). */
const WAITING_THROTTLE_MS = 30 * 60 * 1000;

type RepoJson = Record<string, string>;
type Row = Record<string, LbugValue>;

export class DagStore {
  private constructor(
    private readonly db: Database,
    private readonly conn: Connection,
  ) {}

  static async create(dbPath: string): Promise<DagStore> {
    const db = new DbClass(dbPath, BUFFER_POOL_BYTES) as Database;
    await db.init();
    const conn = new ConnClass(db) as Connection;
    await conn.init();
    const store = new DagStore(db, conn);
    await store.initSchema();
    return store;
  }

  async close(): Promise<void> {
    await this.conn.close();
    await this.db.close();
  }

  closeSync(): void {
    try {
      this.conn.closeSync();
    } catch {
      /* best effort */
    }
    try {
      this.db.closeSync();
    } catch {
      /* best effort */
    }
  }

  // ─── Schema ────────────────────────────────────────────────────────────────

  private async initSchema(): Promise<void> {
    try {
      // Probe — if the TicketGroup table exists, schema is already initialised
      await this.q(`MATCH (g:${T_GROUP}) RETURN COUNT(g) LIMIT 1`);
    } catch {
      await this.q(`CREATE NODE TABLE ${T_GROUP}(
        key                    STRING  PRIMARY KEY,
        sprint                 STRING,
        ticket_keys            STRING[],
        repos                  STRING,
        relation               STRING,
        verification_required  BOOLEAN,
        verification_reason    STRING,
        branches               STRING,
        pr_urls                STRING
      )`);
      await this.q(`CREATE NODE TABLE ${T_EXTRA}(key STRING PRIMARY KEY, sprint STRING)`);
      await this.q(`CREATE REL TABLE ${R_DEP}(FROM ${T_GROUP} TO ${T_GROUP})`);
    }
    // WaitingTicket may not exist in older databases — create if missing.
    try {
      await this.q(`MATCH (w:${T_WAITING}) RETURN COUNT(w) LIMIT 1`);
    } catch {
      await this.q(
        `CREATE NODE TABLE ${T_WAITING}(key STRING PRIMARY KEY, sprint STRING, until INT64)`,
      );
    }
  }

  // ─── Internal query helper ─────────────────────────────────────────────────

  /** Execute a statement with optional parameters. Returns the first QueryResult. */
  private async q(statement: string, params?: Record<string, LbugValue>): Promise<QueryResult> {
    if (params) {
      const ps = await this.conn.prepare(statement);
      const result = await this.conn.execute(ps, params);
      return Array.isArray(result) ? result[0]! : result;
    }
    const result = await this.conn.query(statement);
    return Array.isArray(result) ? result[0]! : result;
  }

  // ─── Write operations ──────────────────────────────────────────────────────

  /**
   * Upsert all groups from the prioritizer result.
   *
   * ON CREATE: initialises branches/pr_urls to empty JSON objects.
   * ON MATCH:  preserves existing branches/pr_urls (pipeline progress).
   *
   * Also deletes stale pending groups (not in new result, no PRs).
   */
  async save(result: PrioritizeResult, sprint: string): Promise<void> {
    // Clear all dependency edges — recreated fresh from new result
    await this.q(`MATCH (:${T_GROUP})-[r:${R_DEP}]->(:${T_GROUP}) DELETE r`);

    const currentKeys: string[] = [];

    /* oxlint-disable no-await-in-loop -- LadybugDB connection is single-threaded; sequential writes required */
    for (const layer of result.layers) {
      const pk = primaryKey(layer);
      currentKeys.push(pk);
      const allKeys = ticketKeys(layer.group);

      await this.q(
        `MERGE (g:${T_GROUP} {key: $key})
         ON CREATE SET
           g.sprint                = $sprint,
           g.ticket_keys           = $ticket_keys,
           g.repos                 = $repos,
           g.relation              = $relation,
           g.verification_required = $vr,
           g.verification_reason   = $vreason,
           g.branches              = '{}',
           g.pr_urls               = '{}'
         ON MATCH SET
           g.sprint                = $sprint,
           g.ticket_keys           = $ticket_keys,
           g.repos                 = $repos,
           g.relation              = $relation,
           g.verification_required = $vr,
           g.verification_reason   = $vreason`,
        {
          key: pk,
          sprint,
          ticket_keys: allKeys,
          repos: JSON.stringify(
            layer.group.map((t) => ({ key: t.key, repos: t.repos, complexity: t.complexity })),
          ),
          relation: layer.relation,
          vr: layer.verification.required,
          vreason: layer.verification.reason,
        },
      );

      if (layer.dependsOn) {
        // dependsOn points to the parent this group depends on
        await this.q(
          `MATCH (a:${T_GROUP} {key: $from}), (b:${T_GROUP} {key: $to}) CREATE (a)-[:${R_DEP}]->(b)`,
          { from: pk, to: layer.dependsOn },
        );
      }
    }

    /* oxlint-enable no-await-in-loop */

    // Remove stale pending groups that are no longer in the result
    if (currentKeys.length > 0) {
      await this.q(
        `MATCH (g:${T_GROUP}) WHERE NOT (g.key IN $currentKeys) AND g.pr_urls = '{}' DETACH DELETE g`,
        { currentKeys },
      );
    }
  }

  /**
   * Persist completed group states (branches + PR URLs) after the pipeline step.
   * Called after each successful group in processLayers.
   */
  async updateGroupStates(groupStates: GroupStates): Promise<void> {
    /* oxlint-disable no-await-in-loop -- LadybugDB connection is single-threaded; sequential writes required */
    for (const [key, state] of groupStates) {
      const branches = JSON.stringify(Object.fromEntries(state.branches));
      const prUrls = JSON.stringify(Object.fromEntries(state.prUrls));
      await this.q(
        `MATCH (g:${T_GROUP} {key: $key}) SET g.branches = $branches, g.pr_urls = $pr_urls`,
        { key, branches, pr_urls: prUrls },
      );
    }
    /* oxlint-enable no-await-in-loop */
  }

  /**
   * Mark a ticket key as completed outside normal group flow.
   * Used for excluded tickets (container stories) and skipped tickets.
   * No-op if the group already has PR URLs (already tracked as completed).
   */
  async markCompleted(key: string): Promise<void> {
    const rows = await (
      await this.q(`MATCH (g:${T_GROUP} {key: $key}) RETURN g.pr_urls AS pr_urls`, { key })
    ).getAll();

    if (rows.length > 0) {
      const prUrls = JSON.parse(((rows as Row[])[0].pr_urls as string) || "{}") as RepoJson;
      if (Object.keys(prUrls).length > 0) return;
    }

    const sprintRows = await (
      await this.q(`MATCH (g:${T_GROUP}) RETURN g.sprint AS sprint LIMIT 1`)
    ).getAll();
    const sprint = ((sprintRows as Row[])[0]?.sprint as string) ?? "";

    await this.q(`MERGE (e:${T_EXTRA} {key: $key}) ON CREATE SET e.sprint = $sprint`, {
      key,
      sprint,
    });
  }

  /**
   * Remove ExtraCompleted entries for tickets no longer in the sprint.
   * Called during discovery with the full set of currently-assigned ticket keys.
   */
  async pruneExtraCompleted(allKeys: Set<string>): Promise<void> {
    if (allKeys.size === 0) return;
    await this.q(`MATCH (e:${T_EXTRA}) WHERE NOT (e.key IN $allKeys) DELETE e`, {
      allKeys: [...allKeys],
    });
  }

  /**
   * Check each in-flight PR. For merged repos: remove from branches/pr_urls.
   * Fully-pruned groups (all repos merged) move to ExtraCompleted.
   * Returns primary keys of fully-pruned groups.
   */
  async pruneMergedGroups(checkMerged?: (url: string) => boolean): Promise<string[]> {
    const isMerged =
      checkMerged ??
      ((url: string) => {
        try {
          const state = execFileSync(
            "gh",
            ["pr", "view", url, "--json", "state", "--jq", ".state"],
            { encoding: "utf-8" },
          ).trim();
          return state === "MERGED";
        } catch {
          return false;
        }
      });

    const rows = await (
      await this.q(
        `MATCH (g:${T_GROUP}) WHERE g.pr_urls <> '{}' RETURN g.key AS key, g.pr_urls AS pr_urls, g.branches AS branches, g.sprint AS sprint`,
      )
    ).getAll();

    const fullyPruned: string[] = [];

    /* oxlint-disable no-await-in-loop -- LadybugDB connection is single-threaded; sequential writes required */
    for (const row of rows) {
      const prUrls = JSON.parse((row.pr_urls as string) || "{}") as RepoJson;
      const branches = JSON.parse((row.branches as string) || "{}") as RepoJson;

      const prunedRepos = new Set<string>();
      for (const [repo, url] of Object.entries(prUrls)) {
        if (isMerged(url)) prunedRepos.add(repo);
      }

      if (prunedRepos.size === 0) continue;

      const updatedPrUrls = Object.fromEntries(
        Object.entries(prUrls).filter(([r]) => !prunedRepos.has(r)),
      );
      const updatedBranches = Object.fromEntries(
        Object.entries(branches).filter(([r]) => !prunedRepos.has(r)),
      );

      if (Object.keys(updatedPrUrls).length === 0) {
        // All repos merged — clear state and move to ExtraCompleted
        await this.q(`MATCH (g:${T_GROUP} {key: $key}) SET g.branches = '{}', g.pr_urls = '{}'`, {
          key: row.key as string,
        });
        await this.q(`MERGE (e:${T_EXTRA} {key: $key}) ON CREATE SET e.sprint = $sprint`, {
          key: row.key as string,
          sprint: (row.sprint as string) ?? "",
        });
        fullyPruned.push(row.key as string);
      } else {
        await this.q(
          `MATCH (g:${T_GROUP} {key: $key}) SET g.branches = $branches, g.pr_urls = $pr_urls`,
          {
            key: row.key as string,
            branches: JSON.stringify(updatedBranches),
            pr_urls: JSON.stringify(updatedPrUrls),
          },
        );
      }
    }

    /* oxlint-enable no-await-in-loop */

    return fullyPruned;
  }

  /** Delete all graph state. Called to start fresh. */
  async clear(): Promise<void> {
    await this.q("MATCH (n) DETACH DELETE n");
  }

  // ─── Read operations ───────────────────────────────────────────────────────

  /**
   * Reconstruct GroupStates for the Dag class to resume mid-sprint.
   * Returns all groups that have non-empty branches (merge step completed).
   * Each group's ticket_keys all map to the same LayerState.
   */
  async loadGroupStates(): Promise<GroupStates> {
    const rows = await (
      await this.q(
        `MATCH (g:${T_GROUP}) WHERE g.branches <> '{}' RETURN g.ticket_keys AS ticket_keys, g.branches AS branches, g.pr_urls AS pr_urls`,
      )
    ).getAll();

    const groupStates: GroupStates = new Map();
    for (const row of rows) {
      const branches = new Map(
        Object.entries(JSON.parse((row.branches as string) || "{}") as RepoJson),
      );
      const prUrls = new Map(
        Object.entries(JSON.parse((row.pr_urls as string) || "{}") as RepoJson),
      );
      const state = { branches, prUrls };
      for (const k of row.ticket_keys as string[]) {
        groupStates.set(k, state);
      }
    }
    return groupStates;
  }

  /** All ticket keys seen in any previous prioritizer run (for in-flight resume). */
  async previousTicketKeys(): Promise<Set<string>> {
    const rows = await (
      await this.q(`MATCH (g:${T_GROUP}) RETURN g.ticket_keys AS ticket_keys`)
    ).getAll();

    const keys = new Set<string>();
    for (const row of rows) {
      for (const k of row.ticket_keys as string[]) keys.add(k);
    }
    return keys;
  }

  /**
   * All ticket keys considered "done" — either their group has PR URLs,
   * or they were explicitly marked via markCompleted().
   */
  async completedTicketKeys(): Promise<Set<string>> {
    const completed = new Set<string>();

    const groupRows = await (
      await this.q(
        `MATCH (g:${T_GROUP}) WHERE g.pr_urls <> '{}' RETURN g.ticket_keys AS ticket_keys`,
      )
    ).getAll();

    for (const row of groupRows) {
      for (const k of row.ticket_keys as string[]) completed.add(k);
    }

    const extraRows = await (await this.q(`MATCH (e:${T_EXTRA}) RETURN e.key AS key`)).getAll();

    for (const row of extraRows) completed.add(row.key as string);

    return completed;
  }

  /**
   * Build a natural-language DAG description for the LLM re-prioritization hint.
   *
   * Emits run-continuity guidance for the prioritizer across two concerns:
   * 1. Branch name stability — pending groups carry their branch names so the
   *    jira-ticket-prioritizer skill reuses them instead of regenerating different
   *    slugs when resuming after a crash.
   * 2. Completed group stacking — GSD-completed tickets move to "In Review" in JIRA,
   *    which the skill would otherwise treat as an unresolved dependency and skip their
   *    dependents (or emit depends_on: null). Listing them as completed groups tells the
   *    skill: even though these tickets are no longer pending, new tickets this run may
   *    still depend on them — keep depends_on references intact so the pipeline can
   *    stack branches correctly especially these GSD-completed tickets are in "In Review".
   *
   * Returns null when no state exists (fresh run).
   */
  async buildGuidance(): Promise<string | null> {
    const groupRows = await (
      await this.q(
        `MATCH (g:${T_GROUP})
         OPTIONAL MATCH (g)-[:${R_DEP}]->(parent:${T_GROUP})
         RETURN g.key AS key, g.ticket_keys AS ticket_keys,
                g.branches AS branches, g.pr_urls AS pr_urls,
                g.repos AS repos, parent.key AS depends_on
         ORDER BY g.key`,
      )
    ).getAll();

    if (groupRows.length === 0) return null;

    const extraRows = await (await this.q(`MATCH (e:${T_EXTRA}) RETURN e.key AS key`)).getAll();

    const extraCompleted = new Set(extraRows.map((r) => r.key as string));

    const completed: Row[] = [];
    const pending: Row[] = [];

    for (const row of groupRows) {
      const prUrls = JSON.parse((row.pr_urls as string) || "{}") as RepoJson;
      const hasPrs = Object.keys(prUrls).length > 0;
      const isPruned = extraCompleted.has(row.key as string) && !hasPrs;
      if (hasPrs || isPruned) {
        completed.push(row);
      } else if (!extraCompleted.has(row.key as string)) {
        pending.push(row);
      }
      // Groups in extraCompleted with no branches/repos are excluded tickets — omit from DAG view
    }

    const lines: string[] = ["PREVIOUS RUN STATE:"];

    if (completed.length > 0) {
      lines.push(
        "",
        "Completed groups (valid depends_on targets; do NOT re-include as active work):",
      );
      for (const row of completed) {
        const prUrls = JSON.parse((row.pr_urls as string) || "{}") as RepoJson;
        const branches = JSON.parse((row.branches as string) || "{}") as RepoJson;
        const keys = row.ticket_keys as string[];
        const keyLabel =
          keys.length > 1 ? `all tickets: ${keys.join(", ")}` : `ticket: ${row.key as string}`;
        lines.push(`  • ${row.key as string} | ${keyLabel}`);
        for (const [repo, branch] of Object.entries(branches)) {
          const repoName = repo.split("/").pop() ?? repo;
          const prUrl = prUrls[repo];
          if (prUrl) {
            lines.push(`    - ${repoName} → branch: ${branch}, PR: ${prUrl}`);
          } else {
            lines.push(`    - ${repoName} → branch: ${branch} [pruned — PR merged]`);
          }
        }
        if (Object.keys(branches).length === 0) lines.push("    (excluded — no branches)");
        if (row.depends_on) lines.push(`    depends_on: ${row.depends_on as string}`);
      }
    }

    if (pending.length > 0) {
      lines.push(
        "",
        "Pending groups (preserve primary key, repo assignments, and branch names exactly):",
      );
      type RepoEntry = { repoPath: string; branch: string };
      type RepoAssignment = { key: string; repos: RepoEntry[]; complexity: string };
      for (const row of pending) {
        const repos = JSON.parse((row.repos as string) || "[]") as RepoAssignment[];
        const keys = row.ticket_keys as string[];
        const keyLabel =
          keys.length > 1 ? `all tickets: ${keys.join(", ")}` : `ticket: ${row.key as string}`;
        lines.push(`  • ${row.key as string} | ${keyLabel}`);
        for (const ticket of repos) {
          for (const ra of ticket.repos) {
            const repoName = ra.repoPath.split("/").pop() ?? ra.repoPath;
            lines.push(`    - ${repoName} → branch: ${ra.branch}`);
          }
        }
        if (row.depends_on) lines.push(`    depends_on: ${row.depends_on as string}`);
      }
    }

    lines.push(
      "",
      "RULES:",
      "- Primary key is the first ticket listed — other groups reference it via depends_on",
      "- Do NOT change branch names for pending groups",
      "- Completed group keys remain valid depends_on targets",
    );

    return lines.join("\n");
  }

  // ─── Waiting state (in-flight dependency throttle) ─────────────────────────

  /**
   * Persist waiting tickets: all keys are blocked on in-flight dependencies for
   * the given sprint. The prioritizer will be suppressed for WAITING_THROTTLE_MS.
   * Replaces any existing waiting entries for this sprint.
   */
  async saveWaiting(sprint: string, keys: string[]): Promise<void> {
    await this.clearWaiting();
    const until = BigInt(Date.now() + WAITING_THROTTLE_MS);
    /* oxlint-disable no-await-in-loop -- single-threaded LadybugDB; sequential writes required */
    for (const key of keys) {
      await this.q(`CREATE (w:${T_WAITING} {key: $key, sprint: $sprint, until: $until})`, {
        key,
        sprint,
        until,
      });
    }
    /* oxlint-enable no-await-in-loop */
  }

  /**
   * Return blocked ticket keys if the throttle is still active for this sprint.
   * Returns null if no waiting state exists, the sprint doesn't match, or the throttle expired.
   */
  async loadWaiting(sprint: string): Promise<string[] | null> {
    const now = BigInt(Date.now());
    const rows = await (
      await this.q(
        `MATCH (w:${T_WAITING}) WHERE w.sprint = $sprint AND w.until > $now RETURN w.key AS key`,
        { sprint, now },
      )
    ).getAll();
    if (rows.length === 0) return null;
    return rows.map((r) => r.key as string);
  }

  /** Clear all waiting ticket entries. */
  async clearWaiting(): Promise<void> {
    await this.q(`MATCH (w:${T_WAITING}) DELETE w`);
  }
}
