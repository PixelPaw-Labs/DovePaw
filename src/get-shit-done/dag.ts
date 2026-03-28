/**
 * DAG (Directed Acyclic Graph) for group dependency resolution.
 *
 * Tracks per-group state, resolves parent merge branches via dependsOn edges,
 * and propagates failures to downstream dependents.
 *
 * No dependency on prioritizer or pipeline internals — operates on a minimal
 * DagNode interface that any group type can satisfy.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Map from repo root path → a string value (branch name, PR URL, etc.). */
export type RepoMap = Map<string, string>;

/** Combined per-repo state produced by a completed group. */
export interface LayerState {
  branches: RepoMap;
  prUrls: RepoMap;
}

/** Per-group state map, keyed by the group's primary ticket key. */
export type GroupStates = Map<string, LayerState>;

/** Minimal interface a group must satisfy for DAG operations. */
export interface DagNode {
  group: ReadonlyArray<{ key: string }>;
  dependsOn: string | null;
}

/** Log function signature (avoids coupling to claude-runner). */
export type DagLogFn = (msg: string) => void;

// ─── Static helpers ──────────────────────────────────────────────────────────

/** Create a fresh empty state (no branches, no PR URLs — merges from main). */
export function emptyState(): LayerState {
  return { branches: new Map(), prUrls: new Map() };
}

/** Return the primary ticket key (first ticket) of a node. */
export function primaryKey(node: DagNode): string {
  return node.group[0]?.key ?? "";
}

/**
 * Validate that dependsOn references only earlier groups and has no forward/self references.
 * Returns an array of warning messages (empty = valid).
 */
export function validateDependsOn(nodes: DagNode[]): string[] {
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const node of nodes) {
    const pk = primaryKey(node);
    const groupKeys = new Set(node.group.map((t) => t.key));

    if (node.dependsOn !== null) {
      const depKey = node.dependsOn;
      if (groupKeys.has(depKey)) {
        warnings.push(`Group ${pk}: depends_on "${depKey}" references itself`);
      } else if (!seen.has(depKey)) {
        warnings.push(
          `Group ${pk}: depends_on "${depKey}" references a group not yet seen — possible forward reference or missing group`,
        );
      }
    }

    for (const t of node.group) {
      seen.add(t.key);
    }
  }

  return warnings;
}

// ─── Class ───────────────────────────────────────────────────────────────────

/**
 * Dependency graph tracker for group processing.
 *
 * Constructed from a list of nodes (topologically sorted) and optional
 * persisted group states from a previous run. Provides resolve/record/fail
 * operations as groups are processed sequentially.
 */
export class Dag {
  private readonly groupStates: GroupStates;
  private readonly failedGroups = new Set<string>();
  private readonly ticketToGroup: Map<string, string>;
  private readonly log: DagLogFn;

  constructor(nodes: DagNode[], log: DagLogFn, initialGroupStates?: GroupStates) {
    this.groupStates = new Map(initialGroupStates ?? []);
    this.ticketToGroup = Dag.buildTicketToGroupMap(nodes);
    this.log = log;
  }

  /**
   * Resolve the parent state for a group.
   * Returns the parent's LayerState, or "skip" if the dependency failed.
   */
  resolve(dependsOn: string | null): LayerState | "skip" {
    if (!dependsOn) return emptyState();

    const groupKey = this.ticketToGroup.get(dependsOn) ?? dependsOn;

    if (this.failedGroups.has(groupKey)) {
      this.log(
        `SKIP: dependency ${dependsOn} (group ${groupKey}) failed — skipping downstream group`,
      );
      return "skip";
    }
    const parent = this.groupStates.get(groupKey);
    if (!parent) {
      this.log(
        `WARN: dependency ${dependsOn} (group ${groupKey}) not found in group states — branching from main`,
      );
      return emptyState();
    }
    return parent;
  }

  /** Record a successful group's output state for all ticket keys. */
  record(keys: string[], state: LayerState): void {
    for (const key of keys) {
      this.groupStates.set(key, state);
    }
  }

  /** Mark a group as failed so downstream dependents are skipped. */
  fail(pk: string): void {
    this.failedGroups.add(pk);
  }

  /** Get the current snapshot of all group states (for persistence). */
  snapshot(): GroupStates {
    return new Map(this.groupStates);
  }

  /** Build a lookup from any ticket key to its group's primary key. */
  private static buildTicketToGroupMap(nodes: DagNode[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const node of nodes) {
      const pk = primaryKey(node);
      for (const ticket of node.group) {
        map.set(ticket.key, pk);
      }
    }
    return map;
  }
}
