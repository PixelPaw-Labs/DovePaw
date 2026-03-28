import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DagStore } from "./dag-store.js";
import type { GroupStates } from "./dag.js";
import type { PrioritizeResult } from "./prioritizer.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(
  layers: Array<{
    key: string;
    extraKeys?: string[];
    repoPath?: string;
    dependsOn?: string | null;
  }>,
  extras: { skipped?: string[]; excluded?: string[] } = {},
): PrioritizeResult {
  return {
    layers: layers.map((l) => ({
      group: [l.key, ...(l.extraKeys ?? [])].map((k) => ({
        key: k,
        repos: l.repoPath ? [{ repoPath: l.repoPath, branch: `${k.toLowerCase()}-fix` }] : [],
        complexity: "moderate" as const,
      })),
      relation: null,
      verification: { required: true, reason: "test" },
      dependsOn: l.dependsOn ?? null,
    })),
    skipped: (extras.skipped ?? []).map((k) => ({
      key: k,
      reason: "skipped",
      inFlightDependency: false,
    })),
    excluded: (extras.excluded ?? []).map((k) => ({ key: k, reason: "excluded" })),
  };
}

function makeGroupStates(
  entries: Array<[string, { branch: string; prUrl?: string }]>,
): GroupStates {
  return new Map(
    entries.map(([key, { branch, prUrl }]) => [
      key,
      {
        branches: new Map([["/repo", branch]]),
        prUrls: prUrl ? new Map([["/repo", prUrl]]) : new Map(),
      },
    ]),
  );
}

// ─── Test setup ──────────────────────────────────────────────────────────────
// One database for the entire file — cleared between tests to avoid
// SIGSEGV from rapid create/close cycles in the LadybugDB native addon.

let store: DagStore;
let tempDir: string;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "dag-store-test-"));
  store = await DagStore.create(join(tempDir, "test.lbug"));
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
  // Skip explicit DB close — the LadybugDB native addon SIGSEGV's during async teardown.
  // The OS will reclaim resources on process exit.
});

beforeEach(async () => {
  await store.clear();
});

// ─── save + loadGroupStates ───────────────────────────────────────────────────

void describe("save + loadGroupStates", () => {
  void it("fresh store has empty groupStates", async () => {
    const gs = await store.loadGroupStates();
    assert.equal(gs.size, 0);
  });

  void it("save creates group nodes queryable via loadGroupStates after updateGroupStates", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");
    await store.updateGroupStates(makeGroupStates([["EC-1", { branch: "ec-1-merge" }]]));

    const gs = await store.loadGroupStates();
    assert.equal(gs.get("EC-1")?.branches.get("/repo"), "ec-1-merge");
  });

  void it("save preserves existing branches/prUrls on re-save", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "Sprint 1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "ec-1-merge", prUrl: "https://pr/1" }]]),
    );

    // Re-save with additional ticket — EC-1's state must be preserved
    await store.save(
      makeResult([
        { key: "EC-1", repoPath: "my-repo" },
        { key: "EC-2", repoPath: "my-repo" },
      ]),
      "Sprint 1",
    );

    const gs = await store.loadGroupStates();
    assert.equal(gs.get("EC-1")?.branches.get("/repo"), "ec-1-merge");
    assert.equal(gs.get("EC-1")?.prUrls.get("/repo"), "https://pr/1");
  });

  void it("save deletes stale pending groups not in new result", async () => {
    await store.save(makeResult([{ key: "EC-1" }, { key: "EC-2" }]), "Sprint 1");
    // EC-2 removed from next prioritization (ticket dropped)
    await store.save(makeResult([{ key: "EC-1" }]), "Sprint 1");

    const keys = await store.previousTicketKeys();
    assert.ok(keys.has("EC-1"));
    assert.ok(!keys.has("EC-2"), "stale pending group should be deleted");
  });

  void it("save preserves completed groups even if not in new result", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "Sprint 1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "ec-1-merge", prUrl: "https://pr/1" }]]),
    );

    // New result doesn't include EC-1 (already done)
    await store.save(makeResult([{ key: "EC-2" }]), "Sprint 1");

    const gs = await store.loadGroupStates();
    assert.ok(gs.has("EC-1"), "completed group with prUrls must be preserved");
  });

  void it("loadGroupStates expands multi-ticket groups to all keys", async () => {
    await store.save(makeResult([{ key: "EC-1", extraKeys: ["EC-2"], repoPath: "repo" }]), "S1");
    await store.updateGroupStates(makeGroupStates([["EC-1", { branch: "ec-1-merge" }]]));

    const gs = await store.loadGroupStates();
    assert.ok(gs.has("EC-1"));
    assert.ok(gs.has("EC-2"), "non-primary ticket key must also map to group state");
    assert.equal(gs.get("EC-2")?.branches.get("/repo"), "ec-1-merge");
  });
});

// ─── previousTicketKeys ───────────────────────────────────────────────────────

void describe("previousTicketKeys", () => {
  void it("returns empty set when no state", async () => {
    const keys = await store.previousTicketKeys();
    assert.equal(keys.size, 0);
  });

  void it("returns all ticket keys from saved layers", async () => {
    await store.save(
      makeResult([{ key: "EC-1", extraKeys: ["EC-2"] }, { key: "EC-3" }]),
      "Sprint 1",
    );
    const keys = await store.previousTicketKeys();
    assert.ok(keys.has("EC-1"));
    assert.ok(keys.has("EC-2"));
    assert.ok(keys.has("EC-3"));
  });
});

// ─── completedTicketKeys ──────────────────────────────────────────────────────

void describe("completedTicketKeys", () => {
  void it("returns empty set initially", async () => {
    const keys = await store.completedTicketKeys();
    assert.equal(keys.size, 0);
  });

  void it("includes groups with non-empty prUrls", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "ec-1-merge", prUrl: "https://pr/1" }]]),
    );

    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"));
  });

  void it("includes all ticket keys of a completed group", async () => {
    await store.save(makeResult([{ key: "EC-1", extraKeys: ["EC-2"], repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "ec-1-merge", prUrl: "https://pr/1" }]]),
    );

    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"));
    assert.ok(keys.has("EC-2"));
  });

  void it("includes extraCompleted keys", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");
    await store.markCompleted("EC-1");

    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"));
  });

  void it("does not include pending groups", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");

    const keys = await store.completedTicketKeys();
    assert.ok(!keys.has("EC-1"));
  });
});

// ─── markCompleted ────────────────────────────────────────────────────────────

void describe("markCompleted", () => {
  void it("adds key to extraCompleted", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");
    await store.markCompleted("EC-1");

    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"));
  });

  void it("is idempotent — marking twice does not fail", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");
    await store.markCompleted("EC-1");
    await store.markCompleted("EC-1");

    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"));
  });

  void it("skips if group already has PR URLs", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "b", prUrl: "https://pr/1" }]]),
    );

    // markCompleted on a group with PRs should be a no-op (completedTicketKeys already sees it)
    await store.markCompleted("EC-1");
    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"));
  });
});

// ─── pruneExtraCompleted ─────────────────────────────────────────────────────

void describe("pruneExtraCompleted", () => {
  void it("removes keys no longer in sprint", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");
    await store.markCompleted("EC-2");
    await store.markCompleted("EC-3");

    // Only EC-3 still in sprint
    await store.pruneExtraCompleted(new Set(["EC-1", "EC-3"]));

    const keys = await store.completedTicketKeys();
    assert.ok(!keys.has("EC-2"), "EC-2 removed — not in sprint");
    assert.ok(keys.has("EC-3"), "EC-3 kept — still in sprint");
  });

  void it("is a no-op when set is empty (guard against deleting all)", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");
    await store.markCompleted("EC-1");

    await store.pruneExtraCompleted(new Set());

    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"), "EC-1 kept — empty set guard");
  });

  void it("keeps merged-PR ticket while still in sprint", async () => {
    // Simulate pruneMergedGroups moving EC-1 to extraCompleted
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "b", prUrl: "https://pr/1" }]]),
    );
    await store.pruneMergedGroups(() => true); // EC-1 → extraCompleted

    // EC-1 is "In Review" — still in sprint
    await store.pruneExtraCompleted(new Set(["EC-1"]));

    const keys = await store.completedTicketKeys();
    assert.ok(keys.has("EC-1"), "EC-1 must stay in completed");
  });
});

// ─── pruneMergedGroups ───────────────────────────────────────────────────────

void describe("pruneMergedGroups", () => {
  void it("returns empty array when no groups have PRs", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");
    const pruned = await store.pruneMergedGroups(() => true);
    assert.deepEqual(pruned, []);
  });

  void it("prunes fully merged groups", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "ec-1-merge", prUrl: "https://pr/1" }]]),
    );

    const pruned = await store.pruneMergedGroups(() => true);
    assert.deepEqual(pruned, ["EC-1"]);

    // EC-1 should now be in extraCompleted
    const completed = await store.completedTicketKeys();
    assert.ok(completed.has("EC-1"));

    // But pr_urls should be cleared
    const gs = await store.loadGroupStates();
    assert.ok(!gs.has("EC-1"), "cleared group should not appear in loadGroupStates");
  });

  void it("only removes the merged repo from partial multi-repo group", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");
    await store.updateGroupStates(
      new Map([
        [
          "EC-1",
          {
            branches: new Map([
              ["/frontend", "ec-1-fe-merge"],
              ["/backend", "ec-1-be-merge"],
            ]),
            prUrls: new Map([
              ["/frontend", "https://pr/fe"],
              ["/backend", "https://pr/be"],
            ]),
          },
        ],
      ]),
    );

    // Only frontend merged
    const pruned = await store.pruneMergedGroups((url) => url === "https://pr/fe");
    assert.deepEqual(pruned, [], "group not fully pruned yet");

    const gs = await store.loadGroupStates();
    assert.ok(!gs.get("EC-1")?.prUrls.has("/frontend"), "frontend removed");
    assert.ok(gs.get("EC-1")?.prUrls.has("/backend"), "backend preserved");
  });

  void it("moves fully pruned group to extraCompleted", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "b", prUrl: "https://pr/1" }]]),
    );

    await store.pruneMergedGroups(() => true); // fully prune EC-1

    const completed = await store.completedTicketKeys();
    assert.ok(completed.has("EC-1"), "EC-1 in extraCompleted after full prune");
  });

  void it("merges pruned group into existing extraCompleted", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "b", prUrl: "https://pr/1" }]]),
    );
    await store.markCompleted("EC-2"); // existing extraCompleted entry

    await store.pruneMergedGroups(() => true);

    const completed = await store.completedTicketKeys();
    assert.ok(completed.has("EC-1"));
    assert.ok(completed.has("EC-2"));
  });

  void it("is safe when no state file exists", async () => {
    const pruned = await store.pruneMergedGroups(() => true);
    assert.deepEqual(pruned, []);
  });
});

// ─── buildGuidance ───────────────────────────────────────────────────────────

void describe("buildGuidance", () => {
  void it("returns null when no state", async () => {
    const guidance = await store.buildGuidance();
    assert.equal(guidance, null);
  });

  void it("shows pending groups with branch names", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "S1");

    const guidance = await store.buildGuidance();
    assert.ok(guidance !== null);
    assert.ok(guidance.includes("EC-1"), "should mention EC-1");
    assert.ok(guidance.includes("Pending groups"), "should have pending section");
    assert.ok(guidance.includes("ec-1-fix"), "should show branch name");
  });

  void it("shows completed groups in completed section", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "my-repo" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "ec-1-merge", prUrl: "https://pr/1" }]]),
    );

    const guidance = await store.buildGuidance();
    assert.ok(guidance !== null);
    assert.ok(guidance.includes("Completed groups"));
    assert.ok(guidance.includes("ec-1-merge"));
    assert.ok(guidance.includes("https://pr/1"));
  });

  void it("shows pruned groups as [pruned — PR merged]", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "ec-1-merge", prUrl: "https://pr/1" }]]),
    );
    await store.pruneMergedGroups(() => true);

    const guidance = await store.buildGuidance();
    assert.ok(guidance !== null);
    // EC-1 is in extraCompleted with empty branches — appears as completed/pruned
    assert.ok(guidance.includes("Completed groups"));
  });

  void it("includes depends_on relationships", async () => {
    await store.save(makeResult([{ key: "EC-1" }, { key: "EC-2", dependsOn: "EC-1" }]), "S1");

    const guidance = await store.buildGuidance();
    assert.ok(guidance !== null);
    assert.ok(guidance.includes("depends_on: EC-1"));
  });

  void it("includes RULES section", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "S1");

    const guidance = await store.buildGuidance();
    assert.ok(guidance?.includes("RULES:"));
  });
});

// ─── clear ───────────────────────────────────────────────────────────────────

void describe("clear", () => {
  void it("removes all state", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "S1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "b", prUrl: "https://pr/1" }]]),
    );
    await store.markCompleted("EC-2");

    await store.clear();

    assert.equal((await store.previousTicketKeys()).size, 0);
    assert.equal((await store.completedTicketKeys()).size, 0);
    assert.equal(await store.buildGuidance(), null);
  });
});

// ─── saveWaiting / loadWaiting / clearWaiting ────────────────────────────────

void describe("saveWaiting / loadWaiting / clearWaiting", () => {
  void it("loadWaiting returns null when no waiting state exists", async () => {
    assert.equal(await store.loadWaiting("Sprint 1"), null);
  });

  void it("loadWaiting returns keys after saveWaiting within throttle window", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1", "EC-2"]);
    const keys = await store.loadWaiting("Sprint 1");
    assert.deepEqual(keys?.sort(), ["EC-1", "EC-2"]);
  });

  void it("loadWaiting returns null for a different sprint", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1"]);
    assert.equal(await store.loadWaiting("Sprint 2"), null);
  });

  void it("loadWaiting returns null after clearWaiting", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1"]);
    await store.clearWaiting();
    assert.equal(await store.loadWaiting("Sprint 1"), null);
  });

  void it("saveWaiting replaces existing entries", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1", "EC-2"]);
    await store.saveWaiting("Sprint 1", ["EC-3"]);
    const keys = await store.loadWaiting("Sprint 1");
    assert.deepEqual(keys, ["EC-3"], "old entries replaced, not appended");
  });

  void it("clearWaiting is a no-op when nothing is saved", async () => {
    await assert.doesNotReject(() => store.clearWaiting());
    assert.equal(await store.loadWaiting("Sprint 1"), null);
  });

  void it("clear() also removes waiting tickets", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1"]);
    await store.clear();
    assert.equal(await store.loadWaiting("Sprint 1"), null);
  });
});

// ─── WaitingTicket isolation from other nodes ────────────────────────────────

void describe("WaitingTicket isolation", () => {
  void it("saveWaiting does not affect TicketGroup nodes", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "Sprint 1");
    await store.saveWaiting("Sprint 1", ["EC-2"]);

    const keys = await store.previousTicketKeys();
    assert.ok(keys.has("EC-1"), "TicketGroup node must survive saveWaiting");
  });

  void it("clearWaiting does not delete TicketGroup or ExtraCompleted nodes", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "Sprint 1");
    await store.markCompleted("EC-2");
    await store.saveWaiting("Sprint 1", ["EC-3"]);

    await store.clearWaiting();

    const previous = await store.previousTicketKeys();
    const completed = await store.completedTicketKeys();
    assert.ok(previous.has("EC-1"), "TicketGroup preserved after clearWaiting");
    assert.ok(completed.has("EC-2"), "ExtraCompleted preserved after clearWaiting");
    assert.equal(await store.loadWaiting("Sprint 1"), null, "waiting state gone");
  });

  void it("pruneMergedGroups does not touch WaitingTicket nodes", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "Sprint 1");
    await store.updateGroupStates(
      makeGroupStates([["EC-1", { branch: "b", prUrl: "https://pr/1" }]]),
    );
    await store.saveWaiting("Sprint 1", ["EC-2"]);

    await store.pruneMergedGroups(() => true);

    const keys = await store.loadWaiting("Sprint 1");
    assert.deepEqual(keys, ["EC-2"], "WaitingTicket nodes survive pruneMergedGroups");
  });

  void it("buildGuidance works correctly when waiting tickets exist alongside TicketGroups", async () => {
    await store.save(makeResult([{ key: "EC-1", repoPath: "r" }]), "Sprint 1");
    await store.saveWaiting("Sprint 1", ["EC-2"]);

    const guidance = await store.buildGuidance();
    assert.ok(guidance !== null, "guidance returned");
    assert.ok(guidance.includes("EC-1"), "pending TicketGroup appears in guidance");
    assert.ok(!guidance.includes("EC-2"), "WaitingTicket does not pollute guidance");
  });

  void it("waiting state from old sprint does not block new sprint", async () => {
    await store.saveWaiting("Sprint 1", ["EC-1"]);

    // New sprint — EC-2 is blocked
    await store.saveWaiting("Sprint 2", ["EC-2"]);

    assert.equal(await store.loadWaiting("Sprint 1"), null, "old sprint waiting gone");
    const keys = await store.loadWaiting("Sprint 2");
    assert.deepEqual(keys, ["EC-2"], "new sprint waiting set correctly");
  });

  void it("markCompleted on a waiting ticket key does not affect WaitingTicket node", async () => {
    await store.save(makeResult([{ key: "EC-1" }]), "Sprint 1");
    await store.saveWaiting("Sprint 1", ["EC-1"]);

    await store.markCompleted("EC-1");

    const completed = await store.completedTicketKeys();
    assert.ok(completed.has("EC-1"), "EC-1 in completed");
    const waiting = await store.loadWaiting("Sprint 1");
    assert.deepEqual(waiting, ["EC-1"], "EC-1 still in WaitingTicket");
  });
});

// ─── DAG resume scenario ─────────────────────────────────────────────────────

void describe("DAG resume", () => {
  void it("full resume: multiple groups with independent state", async () => {
    await store.save(makeResult([{ key: "EC-1" }, { key: "EC-2" }]), "S1");

    await store.updateGroupStates(
      new Map([
        [
          "EC-1",
          {
            branches: new Map([["/storefront", "ec-1-merge"]]),
            prUrls: new Map([["/storefront", "https://pr/1"]]),
          },
        ],
        [
          "EC-2",
          {
            branches: new Map([["/backend", "ec-2-merge"]]),
            prUrls: new Map([["/backend", "https://pr/2"]]),
          },
        ],
      ]),
    );

    // Crash! Re-save with updated guidance
    await store.save(makeResult([{ key: "EC-1" }, { key: "EC-3" }]), "S1");

    const gs = await store.loadGroupStates();
    assert.equal(gs.size, 2, "EC-1 and EC-2 states preserved through re-save");
    assert.equal(gs.get("EC-1")?.branches.get("/storefront"), "ec-1-merge");
    assert.equal(gs.get("EC-2")?.branches.get("/backend"), "ec-2-merge");
  });
});
