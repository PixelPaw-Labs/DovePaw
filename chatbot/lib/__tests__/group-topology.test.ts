import { describe, expect, it } from "vitest";
import type { AgentDef } from "@@/lib/agents";
import type { AgentLink } from "@@/lib/agent-links-schemas";
import { GroupStartTopology } from "@/lib/group-topology";

// Minimal fixture — GroupStartTopology only reads `name`.
const def = (name: string): AgentDef => ({ name }) as AgentDef;

// ─── Actual PixelPaw link fixtures (verbatim from ~/.dovepaw/agent-links.json) ─

/** Peer-to-peer dual chat links between PixelPaw members — no `group` field. */
const PIXELPAW_PEER_CHAT_LINKS: AgentLink[] = [
  {
    source: "pixelpaw-em",
    target: "pixelpaw-pm",
    direction: "dual",
    strategy: "chat",
    handoffScoreMin: 0,
    handoffScoreMax: 100,
  },
  {
    source: "pixelpaw-pm",
    target: "pixelpaw-backend",
    direction: "dual",
    strategy: "chat",
    handoffScoreMin: 0,
    handoffScoreMax: 100,
  },
  {
    source: "pixelpaw-em",
    target: "pixelpaw-backend",
    direction: "dual",
    strategy: "chat",
    handoffScoreMin: 0,
    handoffScoreMax: 100,
  },
  {
    source: "pixelpaw-backend",
    target: "pixelpaw-qa",
    direction: "dual",
    strategy: "chat",
    handoffScoreMin: 0,
    handoffScoreMax: 100,
  },
  {
    source: "pixelpaw-em",
    target: "pixelpaw-qa",
    direction: "dual",
    strategy: "chat",
    handoffScoreMin: 0,
    handoffScoreMax: 100,
  },
  {
    source: "pixelpaw-pm",
    target: "pixelpaw-qa",
    direction: "dual",
    strategy: "chat",
    handoffScoreMin: 0,
    handoffScoreMax: 100,
  },
];

/** Escalation and review links scoped to PixelPaw Labs — strategy != "chat". */
const PIXELPAW_NON_CHAT_LINKS: AgentLink[] = [
  {
    source: "pixelpaw-qa",
    target: "pixelpaw-em",
    direction: "single",
    strategy: "escalation",
    group: "PixelPaw Labs",
    handoffScoreMin: 80,
    handoffScoreMax: 100,
  },
  {
    source: "pixelpaw-qa",
    target: "pixelpaw-backend",
    direction: "single",
    strategy: "review",
    group: "PixelPaw Labs",
    handoffScoreMin: 80,
    handoffScoreMax: 100,
  },
  {
    source: "pixelpaw-backend",
    target: "pixelpaw-em",
    direction: "single",
    strategy: "escalation",
    group: "PixelPaw Labs",
    handoffScoreMin: 80,
    handoffScoreMax: 100,
  },
];

const PIXELPAW_MEMBERS = [
  def("pixelpaw-backend"),
  def("pixelpaw-em"),
  def("pixelpaw-pm"),
  def("pixelpaw-qa"),
];

// ─── GSD Experiment Team link fixtures (agent names replaced with agent-N) ───
//
// Pipeline shape (mirrors actual GSD topology from ~/.dovepaw/agent-links.json):
//   agent-1 → agent-2 → agent-3 → agent-4 → agent-5 → agent-6 → agent-7 → agent-8 → agent-9 → agent-10 → agent-11 → agent-12
//                                          ↘ agent-6 ↗                              ↘ agent-12 ↗
// (agent-4 reaches agent-6 directly AND via agent-5; agent-8 reaches agent-12 directly AND via agent-11)

const GSD_GROUP = "GSD Experiment Team";
const link = (source: string, target: string): AgentLink => ({
  source,
  target,
  direction: "single",
  strategy: "chat",
  group: GSD_GROUP,
  handoffScoreMin: 80,
  handoffScoreMax: 100,
});

const GSD_LINKS: AgentLink[] = [
  link("agent-1", "agent-2"), // discover → prioritize
  link("agent-2", "agent-3"), // prioritize → jira-analyse
  link("agent-3", "agent-4"), // jira-analyse → domain-scan
  link("agent-4", "agent-5"), // domain-scan → db-investigate
  link("agent-4", "agent-6"), // domain-scan → skill-files (also reachable via agent-5)
  link("agent-5", "agent-6"), // db-investigate → skill-files
  link("agent-6", "agent-7"), // skill-files → agent-soul-gen
  link("agent-7", "agent-8"), // agent-soul-gen → forge
  link("agent-8", "agent-9"), // forge → commit
  link("agent-8", "agent-12"), // forge → jira-update (also reachable via agent-11)
  link("agent-9", "agent-10"), // commit → merge
  link("agent-10", "agent-11"), // merge → pr
  link("agent-11", "agent-12"), // pr → jira-update
];

const GSD_MEMBERS = Array.from({ length: 12 }, (_, i) => def(`agent-${i + 1}`));

// ─── PixelPaw Labs ────────────────────────────────────────────────────────────

describe("GroupStartTopology — PixelPaw Labs", () => {
  it("preferred is empty: peer chat links have no group field so are excluded from topology", () => {
    const topo = new GroupStartTopology("PixelPaw Labs", PIXELPAW_PEER_CHAT_LINKS);
    expect(topo.preferred(PIXELPAW_MEMBERS)).toEqual([]);
  });

  it("preferred is empty: escalation and review links are excluded even when group field matches", () => {
    const topo = new GroupStartTopology("PixelPaw Labs", PIXELPAW_NON_CHAT_LINKS);
    expect(topo.preferred(PIXELPAW_MEMBERS)).toEqual([]);
  });

  it("candidates returns all 4 members: no topology links means all tie at reachability 0", () => {
    const allLinks = [...PIXELPAW_PEER_CHAT_LINKS, ...PIXELPAW_NON_CHAT_LINKS];
    const topo = new GroupStartTopology("PixelPaw Labs", allLinks);
    const names = topo
      .candidates(PIXELPAW_MEMBERS)
      .map((d) => d.name)
      .toSorted();
    expect(names).toEqual(["pixelpaw-backend", "pixelpaw-em", "pixelpaw-pm", "pixelpaw-qa"]);
  });

  it("all members have reachability 0 because no group-scoped chat links exist", () => {
    const topo = new GroupStartTopology("PixelPaw Labs", PIXELPAW_PEER_CHAT_LINKS);
    for (const m of PIXELPAW_MEMBERS) {
      expect(topo.reachability(m.name)).toBe(0);
    }
  });
});

// ─── GSD Experiment Team ─────────────────────────────────────────────────────

describe("GroupStartTopology — GSD Experiment Team (pipeline DAG)", () => {
  it("preferred is agent-1: sole DAG root (outDeg=1, inDeg=0)", () => {
    const topo = new GroupStartTopology(GSD_GROUP, GSD_LINKS);
    expect(topo.preferred(GSD_MEMBERS).map((d) => d.name)).toEqual(["agent-1"]);
  });

  it("candidates returns only agent-1 when preferred exists", () => {
    const topo = new GroupStartTopology(GSD_GROUP, GSD_LINKS);
    expect(topo.candidates(GSD_MEMBERS).map((d) => d.name)).toEqual(["agent-1"]);
  });

  it("agent-1 reachability equals total member count minus itself", () => {
    const topo = new GroupStartTopology(GSD_GROUP, GSD_LINKS);
    // agent-12 is reachable via two paths (agent-8→12 and agent-11→12) but counted once.
    expect(topo.reachability("agent-1")).toBe(GSD_MEMBERS.length - 1);
  });

  it("agent-12 reachability is 0: sink node with no outgoing links", () => {
    const topo = new GroupStartTopology(GSD_GROUP, GSD_LINKS);
    expect(topo.reachability("agent-12")).toBe(0);
  });

  it("nodes reachable via two paths are counted once (no double-counting via agent-6)", () => {
    const topo = new GroupStartTopology(GSD_GROUP, GSD_LINKS);
    // agent-4 reaches agent-6 directly AND via agent-5.
    // Unique nodes reachable: agent-5, agent-6, agent-7, agent-8,
    // agent-9, agent-10, agent-11, agent-12 = 8.
    expect(topo.reachability("agent-4")).toBe(8);
  });
});

// ─── Reachability fallback with a cycle (Deep Investigation Team topology) ───
//
// Topology (mirrors ADR-0010 scenario):
//   agent-1 ↔ agent-2  (dual — mutual link, neither is a DAG root)
//   agent-1 → agent-3  (single — downstream analysis node)
//   agent-2 → agent-3  (single — downstream analysis node)

const DIT_GROUP = "Deep Investigation Team";
const DIT_LINKS: AgentLink[] = [
  {
    source: "agent-1",
    target: "agent-2",
    direction: "dual",
    strategy: "chat",
    group: DIT_GROUP,
    handoffScoreMin: 80,
    handoffScoreMax: 100,
  },
  {
    source: "agent-1",
    target: "agent-3",
    direction: "single",
    strategy: "chat",
    group: DIT_GROUP,
    handoffScoreMin: 80,
    handoffScoreMax: 100,
  },
  {
    source: "agent-2",
    target: "agent-3",
    direction: "single",
    strategy: "chat",
    group: DIT_GROUP,
    handoffScoreMin: 80,
    handoffScoreMax: 100,
  },
];
const DIT_MEMBERS = ["agent-1", "agent-2", "agent-3"].map(def);

describe("GroupStartTopology — reachability fallback (cycle case)", () => {
  it("preferred is empty: mutual dual link gives both nodes inDeg > 0", () => {
    const topo = new GroupStartTopology(DIT_GROUP, DIT_LINKS);
    expect(topo.preferred(DIT_MEMBERS)).toEqual([]);
  });

  it("fallback picks agent-1 and agent-2 as highest-reachability nodes", () => {
    const topo = new GroupStartTopology(DIT_GROUP, DIT_LINKS);
    const names = topo
      .fallback(DIT_MEMBERS)
      .map((d) => d.name)
      .toSorted();
    expect(names).toEqual(["agent-1", "agent-2"]);
  });

  it("candidates returns agent-1 and agent-2, not the downstream agent-3", () => {
    const topo = new GroupStartTopology(DIT_GROUP, DIT_LINKS);
    const names = topo
      .candidates(DIT_MEMBERS)
      .map((d) => d.name)
      .toSorted();
    expect(names).toEqual(["agent-1", "agent-2"]);
  });

  it("agent-3 has lower reachability than the entry points", () => {
    const topo = new GroupStartTopology(DIT_GROUP, DIT_LINKS);
    expect(topo.reachability("agent-3")).toBeLessThan(topo.reachability("agent-1"));
    expect(topo.reachability("agent-3")).toBeLessThan(topo.reachability("agent-2"));
  });

  it("agent-1 and agent-2 have equal reachability by symmetry", () => {
    const topo = new GroupStartTopology(DIT_GROUP, DIT_LINKS);
    expect(topo.reachability("agent-1")).toBe(topo.reachability("agent-2"));
  });
});
