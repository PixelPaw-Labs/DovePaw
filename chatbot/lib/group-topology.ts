import type { AgentDef } from "@@/lib/agents";
import type { AgentLink } from "@@/lib/agent-links-schemas";

/**
 * Computes the startable candidate set for a group from its chat-strategy link subgraph.
 *
 * Selection order:
 * 1. **Preferred** — DAG roots: outDeg > 0 and inDeg = 0 (hand off to others, nobody hands off to them).
 * 2. **Fallback** — when no preferred exists, pick members with the highest transitive reachability.
 *    Ties are kept. All-zero scores (no links configured) returns the full roster.
 *
 * See ADR-0010 for full rationale.
 */
export class GroupStartTopology {
  private readonly outDeg = new Map<string, number>();
  private readonly inDeg = new Map<string, number>();
  private readonly adj = new Map<string, string[]>();

  constructor(groupName: string, links: AgentLink[]) {
    for (const l of links) {
      if (l.group !== groupName) continue;
      if (l.strategy !== "chat") continue;
      this.addEdge(l.source, l.target);
      if (l.direction === "dual") this.addEdge(l.target, l.source);
    }
  }

  private addEdge(source: string, target: string): void {
    this.outDeg.set(source, (this.outDeg.get(source) ?? 0) + 1);
    this.inDeg.set(target, (this.inDeg.get(target) ?? 0) + 1);
    const neighbors = this.adj.get(source) ?? [];
    neighbors.push(target);
    this.adj.set(source, neighbors);
  }

  /** DAG roots: agents that hand off to others but receive no handoffs themselves. */
  preferred(memberDefs: AgentDef[]): AgentDef[] {
    return memberDefs.filter(
      (d) => (this.outDeg.get(d.name) ?? 0) > 0 && (this.inDeg.get(d.name) ?? 0) === 0,
    );
  }

  /** Transitive count of unique nodes reachable from `name` (cycle-safe via visited set). */
  reachability(name: string, visited: Set<string> = new Set()): number {
    if (visited.has(name)) return 0;
    visited.add(name);
    // Only count t if not yet visited — avoids double-counting nodes reachable via multiple paths.
    return (this.adj.get(name) ?? []).reduce(
      (sum, t) => sum + (visited.has(t) ? 0 : 1) + this.reachability(t, visited),
      0,
    );
  }

  /** Highest-reachability members when no preferred exists. Ties are kept. */
  fallback(memberDefs: AgentDef[]): AgentDef[] {
    const scores = new Map(memberDefs.map((d) => [d.name, this.reachability(d.name)]));
    const max = Math.max(0, ...scores.values());
    return memberDefs.filter((d) => (scores.get(d.name) ?? 0) === max);
  }

  /** Preferred if any exist, otherwise reachability fallback. */
  candidates(memberDefs: AgentDef[]): AgentDef[] {
    const pref = this.preferred(memberDefs);
    return pref.length > 0 ? pref : this.fallback(memberDefs);
  }
}
