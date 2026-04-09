import { describe, it, expect } from "vitest";
import { upsertProgressEntry, mergeProgress, mergeProgressEntries } from "../progress";
import type { ProgressEntry } from "../progress";

// ─── upsertProgressEntry ──────────────────────────────────────────────────────

describe("upsertProgressEntry", () => {
  it("appends a new entry", () => {
    const progress: ProgressEntry[] = [];
    upsertProgressEntry(progress, "Starting…", {});
    expect(progress).toEqual([{ message: "Starting…", artifacts: {} }]);
  });

  it("skips empty message", () => {
    const progress: ProgressEntry[] = [];
    upsertProgressEntry(progress, "", { repo: "org/a" });
    expect(progress).toHaveLength(0);
  });

  it("skips exact duplicate (idempotent)", () => {
    const progress: ProgressEntry[] = [];
    upsertProgressEntry(progress, "Cloning", { repo: "org/a" });
    upsertProgressEntry(progress, "Cloning", { repo: "org/a" });
    expect(progress).toHaveLength(1);
  });

  it("appends distinct entry when same message but different artifacts (parallel ops)", () => {
    const progress: ProgressEntry[] = [];
    upsertProgressEntry(progress, "Cloning", { repo: "org/a" });
    upsertProgressEntry(progress, "Cloning", { repo: "org/b" });
    expect(progress).toEqual([
      { message: "Cloning", artifacts: { repo: "org/a" } },
      { message: "Cloning", artifacts: { repo: "org/b" } },
    ]);
  });

  it("accumulates multiple parallel clone entries independently", () => {
    const progress: ProgressEntry[] = [];
    upsertProgressEntry(progress, "Cloning", { repo: "org/a" });
    upsertProgressEntry(progress, "Cloning", { repo: "org/b" });
    upsertProgressEntry(progress, "Cloning", { repo: "org/c" });
    expect(progress).toHaveLength(3);
    expect(progress.map((e) => e.artifacts.repo)).toEqual(["org/a", "org/b", "org/c"]);
  });

  it("keeps distinct messages as separate entries", () => {
    const progress: ProgressEntry[] = [];
    upsertProgressEntry(progress, "Starting…", {});
    upsertProgressEntry(progress, "Creating workspace", { workspace: "/tmp/ws" });
    upsertProgressEntry(progress, "Cloning", { repo: "org/a" });
    expect(progress).toHaveLength(3);
  });
});

// ─── mergeProgress ────────────────────────────────────────────────────────────

describe("mergeProgress", () => {
  it("appends entries not in existing", () => {
    const existing: ProgressEntry[] = [{ message: "Starting…", artifacts: {} }];
    const incoming: ProgressEntry[] = [{ message: "Cloning", artifacts: { repo: "org/a" } }];
    expect(mergeProgress(existing, incoming)).toEqual([
      { message: "Starting…", artifacts: {} },
      { message: "Cloning", artifacts: { repo: "org/a" } },
    ]);
  });

  it("skips exact duplicates", () => {
    const entry: ProgressEntry = { message: "Cloning", artifacts: { repo: "org/a" } };
    expect(mergeProgress([entry], [entry])).toHaveLength(1);
  });

  it("spreads incoming artifacts over existing on same-name match", () => {
    const existing: ProgressEntry[] = [{ message: "Cloning", artifacts: { repo: "org/a" } }];
    const incoming: ProgressEntry[] = [
      { message: "Cloning", artifacts: { repo: "org/a", label: "done" } },
    ];
    const result = mergeProgress(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].artifacts).toEqual({ repo: "org/a", label: "done" });
  });
});

// ─── mergeProgressEntries ─────────────────────────────────────────────────────

describe("mergeProgressEntries", () => {
  it("skips exact duplicates", () => {
    const entry: ProgressEntry = { message: "Cloning", artifacts: { repo: "org/a" } };
    expect(mergeProgressEntries([entry], [entry])).toHaveLength(1);
  });

  it("skips stale replay (incoming is value-subset of existing)", () => {
    const existing: ProgressEntry[] = [
      { message: "Running tool", artifacts: { toolId: "123", label: "Grep" } },
    ];
    const incoming: ProgressEntry[] = [{ message: "Running tool", artifacts: { toolId: "123" } }];
    expect(mergeProgressEntries(existing, incoming)).toHaveLength(1);
  });

  it("updates in place when incoming is a superset of existing keys", () => {
    const existing: ProgressEntry[] = [{ message: "Running tool", artifacts: { toolId: "123" } }];
    const incoming: ProgressEntry[] = [
      { message: "Running tool", artifacts: { toolId: "123", label: "Grep" } },
    ];
    const result = mergeProgressEntries(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].artifacts).toEqual({ toolId: "123", label: "Grep" });
  });

  it("appends when artifact key sets differ (parallel tickets with same step label)", () => {
    // Different key sets: "ticket" vs "pr" — genuinely distinct operations
    const existing: ProgressEntry[] = [{ message: "Forging", artifacts: { ticket: "PROJ-1" } }];
    const incoming: ProgressEntry[] = [{ message: "Forging", artifacts: { pr: "42" } }];
    const result = mergeProgressEntries(existing, incoming);
    expect(result).toHaveLength(2);
  });

  it("appends when same key but different value (parallel ops with same label)", () => {
    // Same key "repo" but different values — two distinct clone operations
    const existing: ProgressEntry[] = [{ message: "Cloning", artifacts: { repo: "org/a" } }];
    const incoming: ProgressEntry[] = [{ message: "Cloning", artifacts: { repo: "org/b" } }];
    const result = mergeProgressEntries(existing, incoming);
    expect(result).toHaveLength(2);
  });
});
