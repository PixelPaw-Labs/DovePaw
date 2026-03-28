import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Dag,
  primaryKey,
  validateDependsOn,
  emptyState,
  type GroupStates,
  type LayerState,
  type DagNode,
} from "./dag.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectLogs(): { logs: string[]; log: (msg: string) => void } {
  const logs: string[] = [];
  return { logs, log: (msg: string) => logs.push(msg) };
}

function dn(key: string, dependsOn: string | null, extraKeys: string[] = []): DagNode {
  return { group: [{ key }, ...extraKeys.map((k) => ({ key: k }))], dependsOn };
}

// ─── primaryKey ──────────────────────────────────────────────────────────────

void describe("primaryKey", () => {
  void it("returns first ticket key", () => {
    assert.equal(primaryKey(dn("EC-1", null, ["EC-2"])), "EC-1");
  });

  void it("returns empty string for empty group", () => {
    assert.equal(primaryKey({ group: [], dependsOn: null }), "");
  });
});

// ─── emptyState ──────────────────────────────────────────────────────────────

void describe("emptyState", () => {
  void it("returns fresh maps each call", () => {
    const a = emptyState();
    const b = emptyState();
    assert.notEqual(a, b);
    assert.equal(a.branches.size, 0);
    assert.equal(a.prUrls.size, 0);
  });
});

// ─── Dag class ───────────────────────────────────────────────────────────────

void describe("Dag", () => {
  void it("resolve returns empty state when dependsOn is null", () => {
    const dag = new Dag([dn("EC-1", null)], () => {});
    const result = dag.resolve(null);
    assert.notEqual(result, "skip");
    assert.equal((result as LayerState).branches.size, 0);
  });

  void it("resolve returns parent state after record", () => {
    const dag = new Dag([dn("EC-1", null), dn("EC-2", "EC-1")], () => {});
    dag.record(["EC-1"], { branches: new Map([["/repo", "ec-1-merge"]]), prUrls: new Map() });

    const result = dag.resolve("EC-1");
    assert.notEqual(result, "skip");
    assert.equal((result as LayerState).branches.get("/repo"), "ec-1-merge");
  });

  void it("resolve resolves non-primary ticket to its group", () => {
    const dag = new Dag([dn("EC-1", null, ["EC-2"]), dn("EC-3", "EC-2")], () => {});
    dag.record(["EC-1"], { branches: new Map([["/repo", "ec-1-merge"]]), prUrls: new Map() });

    const result = dag.resolve("EC-2");
    assert.notEqual(result, "skip");
    assert.equal((result as LayerState).branches.get("/repo"), "ec-1-merge");
  });

  void it("resolve returns skip when dependency failed", () => {
    const dag = new Dag([dn("EC-1", null), dn("EC-2", "EC-1")], () => {});
    dag.fail("EC-1");
    assert.equal(dag.resolve("EC-1"), "skip");
  });

  void it("resolve returns skip when non-primary ticket's group failed", () => {
    const dag = new Dag([dn("EC-1", null, ["EC-2"]), dn("EC-3", "EC-2")], () => {});
    dag.fail("EC-1");
    assert.equal(dag.resolve("EC-2"), "skip");
  });

  void it("resolve warns and returns empty state for missing dependency", () => {
    const { logs, log } = collectLogs();
    const dag = new Dag([dn("EC-1", "EC-MISSING")], log);

    const result = dag.resolve("EC-MISSING");
    assert.notEqual(result, "skip");
    assert.equal((result as LayerState).branches.size, 0);
    assert.ok(logs.some((l) => l.includes("EC-MISSING") && l.includes("not found")));
  });

  void it("snapshot returns a copy of groupStates", () => {
    const dag = new Dag([dn("EC-1", null)], () => {});
    dag.record(["EC-1"], { branches: new Map([["/repo", "b"]]), prUrls: new Map() });

    const snap = dag.snapshot();
    assert.equal(snap.get("EC-1")?.branches.get("/repo"), "b");
    assert.equal(snap.size, 1);
  });

  void it("record stores state for all ticket keys in group", () => {
    const dag = new Dag([dn("EC-1", null, ["EC-2"])], () => {});
    const state: LayerState = {
      branches: new Map([["/repo", "merge-branch"]]),
      prUrls: new Map([["/repo", "https://pr/1"]]),
    };
    dag.record(["EC-1", "EC-2"], state);

    const snap = dag.snapshot();
    assert.equal(snap.get("EC-1")?.prUrls.get("/repo"), "https://pr/1");
    assert.equal(snap.get("EC-2")?.prUrls.get("/repo"), "https://pr/1");
    assert.equal(snap.size, 2);
  });

  void it("seeds from initialGroupStates", () => {
    const initial: GroupStates = new Map([
      ["EC-1", { branches: new Map([["/repo", "ec-1-merge"]]), prUrls: new Map() }],
    ]);
    const dag = new Dag([dn("EC-2", "EC-1")], () => {}, initial);

    const result = dag.resolve("EC-1");
    assert.notEqual(result, "skip");
    assert.equal((result as LayerState).branches.get("/repo"), "ec-1-merge");
  });

  void it("ticketToGroup maps every ticket to its group primary key", () => {
    const nodes: DagNode[] = [dn("EC-1", null, ["EC-2"]), dn("EC-3", "EC-1")];
    const dag = new Dag(nodes, () => {});
    dag.record(["EC-1"], { branches: new Map([["/r", "b"]]), prUrls: new Map() });

    // EC-2 resolves to EC-1's group
    const result = dag.resolve("EC-2");
    assert.notEqual(result, "skip");
    assert.equal((result as LayerState).branches.get("/r"), "b");
  });
});

// ─── validateDependsOn ──────────────────────────────────────────────────────

void describe("validateDependsOn", () => {
  void it("returns no warnings for valid DAG", () => {
    assert.deepEqual(
      validateDependsOn([dn("EC-1", null), dn("EC-2", "EC-1"), dn("EC-3", "EC-2")]),
      [],
    );
  });

  void it("returns no warnings for all-root groups", () => {
    assert.deepEqual(validateDependsOn([dn("EC-1", null), dn("EC-2", null)]), []);
  });

  void it("returns no warnings for diamond DAG", () => {
    assert.deepEqual(
      validateDependsOn([dn("EC-1", null), dn("EC-2", "EC-1"), dn("EC-3", "EC-1")]),
      [],
    );
  });

  void it("returns no warnings when dependsOn references non-primary ticket in earlier group", () => {
    assert.deepEqual(validateDependsOn([dn("EC-1", null, ["EC-2"]), dn("EC-3", "EC-2")]), []);
  });

  void it("warns on forward reference", () => {
    const warnings = validateDependsOn([dn("EC-1", "EC-2"), dn("EC-2", null)]);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("EC-2") && warnings[0].includes("not yet seen"));
  });

  void it("warns on self-reference", () => {
    const warnings = validateDependsOn([dn("EC-1", "EC-1")]);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("references itself"));
  });

  void it("warns on reference to non-existent group", () => {
    const warnings = validateDependsOn([dn("EC-1", null), dn("EC-2", "EC-MISSING")]);
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes("EC-MISSING") && warnings[0].includes("not yet seen"));
  });
});
