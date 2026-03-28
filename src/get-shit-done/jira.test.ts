import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ─── fetchSprintTickets JSON parsing ─────────────────────────────────────────
//
// Critical fix: use --raw JSON instead of --plain tab-separated output.
// EC-9244 returned "EC-9244\t\tBacklog" (double tab) so status parsed as "".

type RawTicket = { key: string; fields: { status: { name: string } } };

function parseSprintTickets(ok: boolean, stdout: string): Array<{ key: string; status: string }> {
  if (!ok || !stdout) return [];
  try {
    const data = JSON.parse(stdout) as RawTicket[];
    return data.map((item) => ({ key: item.key, status: item.fields.status.name }));
  } catch {
    return [];
  }
}

void describe("fetchSprintTickets JSON parsing", () => {
  void it("parses key and status from raw JSON", () => {
    const stdout = JSON.stringify([
      { key: "EC-11112", fields: { status: { name: "In Review" } } },
      { key: "EC-9244", fields: { status: { name: "Backlog" } } },
    ]);

    assert.deepEqual(parseSprintTickets(true, stdout), [
      { key: "EC-11112", status: "In Review" },
      { key: "EC-9244", status: "Backlog" },
    ]);
  });

  void it("correctly parses Backlog status — regression for double-tab bug", () => {
    const stdout = JSON.stringify([{ key: "EC-9244", fields: { status: { name: "Backlog" } } }]);
    const result = parseSprintTickets(true, stdout);
    assert.equal(result[0].key, "EC-9244");
    assert.equal(result[0].status, "Backlog");
  });

  void it("returns empty array when exec fails", () => {
    assert.deepEqual(parseSprintTickets(false, ""), []);
  });

  void it("returns empty array on invalid JSON", () => {
    assert.deepEqual(parseSprintTickets(true, "not json"), []);
  });

  void it("handles all sprint statuses correctly", () => {
    const statuses = ["To Do", "Backlog", "In Progress", "In Review", "Done"];
    const stdout = JSON.stringify(
      statuses.map((s, i) => ({ key: `EC-${i}`, fields: { status: { name: s } } })),
    );
    const result = parseSprintTickets(true, stdout);
    assert.equal(result.length, 5);
    for (let i = 0; i < statuses.length; i++) {
      assert.equal(result[i].status, statuses[i]);
    }
  });
});

// ─── hasUnfinishedSubtasks JSON parsing ──────────────────────────────────────
//
// Bug fix: empty result from jira CLI exits with code 1 and stderr containing
// "No result found". Previously this was treated as an error (return true),
// incorrectly assuming unfinished subtasks when there were none.

function parseHasUnfinished(ok: boolean, stdout: string, stderr: string | undefined): boolean {
  if (!ok) {
    if (stderr?.includes("No result found")) return false;
    return true; // genuine error — assume unfinished to be safe
  }
  try {
    const data = JSON.parse(stdout) as unknown[];
    return data.length > 0;
  } catch {
    return true;
  }
}

void describe("hasUnfinishedSubtasks JSON parsing", () => {
  void it("returns true when subtasks exist", () => {
    const stdout = JSON.stringify([{ key: "EC-100", fields: { status: { name: "To Do" } } }]);
    assert.equal(parseHasUnfinished(true, stdout, undefined), true);
  });

  void it("returns false when JSON array is empty", () => {
    assert.equal(parseHasUnfinished(true, "[]", undefined), false);
  });

  void it("returns false when jira CLI reports no results found", () => {
    assert.equal(parseHasUnfinished(false, "", "✗ No result found for given query"), false);
  });

  void it("returns true on genuine exec error (safe default)", () => {
    assert.equal(parseHasUnfinished(false, "", "connection refused"), true);
  });

  void it("returns true on JSON parse error (safe default)", () => {
    assert.equal(parseHasUnfinished(true, "not json", undefined), true);
  });
});
