/**
 * GSD Orchestrator — coordinates the full get-shit-done workflow.
 *
 * Steps: discover → prioritize → process → summarize
 */

import type { LogFn } from "./claude-runner.js";
import type { JiraClient } from "./jira.js";
import type { DagStore } from "./dag-store.js";
import type { GroupedLayer, SkippedTicket } from "./prioritizer.js";
import type { GroupStates } from "./dag.js";
import type { SprintDiscovery, DiscoverResult } from "./discovery.js";
import { Prioritizer } from "./prioritizer.js";
import { Pipeline } from "./pipeline.js";
import { resetReposToMain } from "../lib/repos.js";

export interface OrchestratorDeps {
  discovery: SprintDiscovery;
  prioritizer: Prioritizer;
  pipeline: Pipeline;
  jira: JiraClient;
  runState: DagStore;
  baseRepos: string[];
  log: LogFn;
}

interface PrioritizeResult {
  layers: GroupedLayer[];
  skipped: SkippedTicket[];
  excluded: Array<{ key: string; reason: string }>;
  initialGroupStates?: GroupStates;
}

export class GSDOrchestrator {
  private readonly discovery: SprintDiscovery;
  private readonly prioritizer: Prioritizer;
  private readonly pipeline: Pipeline;
  private readonly jira: JiraClient;
  private readonly runState: DagStore;
  private readonly baseRepos: string[];
  private readonly log: LogFn;

  constructor(deps: OrchestratorDeps) {
    this.discovery = deps.discovery;
    this.prioritizer = deps.prioritizer;
    this.pipeline = deps.pipeline;
    this.jira = deps.jira;
    this.runState = deps.runState;
    this.baseRepos = deps.baseRepos;
    this.log = deps.log;
  }

  /**
   * Re-include in-flight tickets from a previous run that were moved to
   * "In Progress" by forge but never completed (crash/restart scenario).
   * Discovery drops them because classifyTickets only considers "To Do"/"Backlog".
   * Skips tickets whose group already completed (has PRs — e.g. "In Review").
   */
  private async resumeInFlightTickets(discovery: DiscoverResult): Promise<void> {
    const previousKeys = await this.runState.previousTicketKeys();
    if (previousKeys.size === 0) return;

    const completedKeys = await this.runState.completedTicketKeys();
    const unprocessedSet = new Set(discovery.unprocessed);

    for (const key of previousKeys) {
      if (completedKeys.has(key) || unprocessedSet.has(key) || !discovery.allKeys.includes(key)) {
        if (completedKeys.has(key) && !unprocessedSet.has(key) && discovery.allKeys.includes(key)) {
          this.log(`SKIP RESUME: ${key} — already completed in previous run`);
        }
        continue;
      }
      discovery.unprocessed.push(key);
      this.log(`RESUME: ${key} — in-flight from previous run, re-including`);
    }
  }

  /** Step 1: Prioritize tickets, guided by previous run if available. */
  async prioritize(
    allKeys: string[],
    unprocessed: string[],
    sprint: string,
  ): Promise<PrioritizeResult> {
    resetReposToMain(this.baseRepos, this.log);

    // Skip the prioritizer when all unprocessed tickets are still blocked on in-flight
    // dependencies from the last run and the 30-minute throttle hasn't expired yet.
    // Returning empty skipped avoids re-commenting on JIRA — that was done on the first run.
    const waitingKeys = await this.runState.loadWaiting(sprint);
    const waitingSet = waitingKeys ? new Set(waitingKeys) : null;
    if (waitingSet && unprocessed.every((k) => waitingSet.has(k))) {
      this.log(
        `WAITING: all pending ticket(s) blocked on in-flight dependencies — skipping prioritizer`,
      );
      return { layers: [], skipped: [], excluded: [] };
    }

    // Clear stale waiting state before calling the LLM — new work may be available.
    if (waitingKeys) await this.runState.clearWaiting();

    const previousGuidance = await this.runState.buildGuidance();
    const initialGroupStates = await this.runState.loadGroupStates();

    const { resolved } = await this.prioritizer.prioritize(
      allKeys,
      this.baseRepos,
      previousGuidance ?? undefined,
    );
    await this.runState.save(resolved, sprint);

    // Mark excluded tickets as completed so subsequent runs skip them in discovery.
    /* oxlint-disable no-await-in-loop -- sequential state mutations required */
    for (const e of resolved.excluded) {
      await this.runState.markCompleted(e.key);
    }
    /* oxlint-enable no-await-in-loop */

    // If every pending ticket is blocked on an in-flight dependency, save the waiting
    // state so the next run skips the prioritizer for up to 30 minutes.
    const allInFlight =
      resolved.layers.length === 0 &&
      resolved.skipped.length > 0 &&
      resolved.skipped.every((s) => s.inFlightDependency);
    if (allInFlight) {
      await this.runState.saveWaiting(
        sprint,
        resolved.skipped.map((s) => s.key),
      );
    }

    return {
      layers: resolved.layers,
      skipped: resolved.skipped,
      excluded: resolved.excluded,
      initialGroupStates: initialGroupStates.size > 0 ? initialGroupStates : undefined,
    };
  }

  /** Step 3: Process layers — forge, merge, verify, PR. */
  async process(
    discovery: DiscoverResult,
    prioritization: PrioritizeResult,
  ): Promise<{ succeeded: number; failed: number }> {
    const { layers, skipped, excluded, initialGroupStates } = prioritization;

    for (const s of skipped) this.log(`INFO: skipping ${s.key} — ${s.reason}`);
    for (const e of excluded) this.log(`INFO: excluded ${e.key} — ${e.reason}`);

    const unprocessedSet = new Set(discovery.unprocessed);

    // In-flight dependency blocks stay in To Do — they must be retried once the dependency merges.
    // Permanently skipped tickets (redundant, out-of-scope) are closed out: comment + promote + mark completed.
    const skippedPending = skipped.filter((s) => unprocessedSet.has(s.key));
    /* oxlint-disable no-await-in-loop -- sequential JIRA mutations required */
    for (const s of skippedPending) {
      const commented = await this.jira.addComment(s.key, s.reason);
      if (!commented) this.log(`WARN: Could not comment on ${s.key}`);
      if (s.inFlightDependency) {
        this.log(
          `WAITING: ${s.key} — commented, keeping in To Do (blocked on in-flight dependency)`,
        );
      } else {
        await this.jira.promoteToReview(s.key, this.log);
        await this.runState.markCompleted(s.key);
        this.log(`SKIPPED: ${s.key} — commented and moved to In Review`);
      }
    }
    /* oxlint-enable no-await-in-loop */

    // Promote excluded container stories whose sub-tasks are all already done.
    // Catches the case where a previous run finished all sub-tasks but crashed
    // before promoting the parent.
    const excludedPending = excluded.filter((e) => unprocessedSet.has(e.key));
    if (excludedPending.length > 0) {
      const promotedParents = new Set<string>();
      /* oxlint-disable no-await-in-loop -- sequential: promotedParents dedup requires ordering */
      for (const e of excludedPending) {
        const hasUnfinished = await this.jira.hasUnfinishedSubtasks(e.key);
        if (hasUnfinished) {
          this.log(`SKIP PROMOTE: ${e.key} — still has unfinished sub-tasks`);
        } else {
          this.log(`PROMOTE: ${e.key} — all sub-tasks complete`);
          await this.jira.promoteToReview(e.key, this.log, promotedParents);
        }
      }
      /* oxlint-enable no-await-in-loop */
    }

    return this.pipeline.processLayers(
      layers,
      unprocessedSet,
      new Set(skipped.map((s) => s.key)),
      new Set(excluded.map((e) => e.key)),
      initialGroupStates,
      this.runState,
    );
  }

  /** Step 4: Log summary. State is preserved for next-run guidance. */
  summarize(succeeded: number, skippedCount: number, failed: number): void {
    this.log(`=== Summary: processed=${succeeded} skipped=${skippedCount} failed=${failed} ===`);
  }

  /** Run the full workflow: discover → prioritize → process → summarize. */
  async run(): Promise<void> {
    const discovery = await this.discovery.discover(this.log);
    if (!discovery) return;

    const pruned = await this.runState.pruneMergedGroups();
    for (const key of pruned) {
      this.log(`PRUNED: ${key} — PR merged, moved to completed`);
    }

    await this.resumeInFlightTickets(discovery);

    const prioritization = await this.prioritize(
      discovery.allKeys,
      discovery.unprocessed,
      discovery.sprint,
    );
    const { succeeded, failed } = await this.process(discovery, prioritization);

    this.summarize(succeeded, discovery.skippedCount, failed);
  }
}
