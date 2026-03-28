import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parsePrioritizerOutput,
  fallbackResult,
  classifyTickets,
  filterGroup,
  type TicketAssignment,
} from "./prioritizer.js";

/** Build a minimal valid layer for tests that don't care about specific fields. */
function makeLayer(keys: string[], verification = { required: false, reason: "test" }) {
  return {
    group: keys.map((key) => ({ key, repos: [] as Array<{ repo: string; branch: string }> })),
    relation: null,
    verification,
  };
}

void describe("parsePrioritizerOutput", () => {
  void it("parses grouped format with all fields", () => {
    const input = JSON.stringify({
      layers: [
        {
          group: [
            {
              key: "EC-100",
              complexity: "moderate",
              repos: [{ repo: "acme-api", branch: "ec-100-fix" }],
            },
            {
              key: "EC-104",
              complexity: "moderate",
              repos: [{ repo: "acme-web", branch: "ec-104-ui" }],
            },
          ],
          relation: "same-epic",
          verification: { required: true, reason: "updates login UI" },
        },
        {
          group: [
            {
              key: "EC-101",
              complexity: "moderate",
              repos: [{ repo: "acme-api", branch: "ec-101-rate" }],
            },
          ],
          relation: null,
          verification: { required: false, reason: "API-only" },
        },
      ],
      skipped: [{ key: "EC-102", reason: "depends on EC-100 (status: In Progress)" }],
      excluded: [{ key: "EC-99", reason: "Done" }],
    });

    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.layers.length, 2);
    assert.equal(result.layers[0].group[0].key, "EC-100");
    assert.equal(result.layers[0].group[0].repos[0].repoPath, "acme-api");
    assert.equal(result.layers[0].group[1].key, "EC-104");
    assert.equal(result.layers[0].relation, "same-epic");
    assert.equal(result.layers[0].verification.required, true);
    assert.equal(result.layers[0].verification.reason, "updates login UI");
    assert.equal(result.layers[1].verification.required, false);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].key, "EC-102");
    assert.equal(result.excluded.length, 1);
    assert.equal(result.excluded[0].key, "EC-99");
  });

  void it("strips code fences before parsing", () => {
    const json = JSON.stringify({
      layers: [makeLayer(["EC-1"])],
    });
    const input = "```json\n" + json + "\n```";

    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.layers.length, 1);
  });

  void it("returns empty result for layers blocked on in-flight dependencies", () => {
    const input = JSON.stringify({
      layers: [],
      skipped: [
        {
          key: "EC-123",
          reason: "blocked on EC-100 which is In Review",
          in_flight_dependency: true,
        },
      ],
      excluded: [],
    });
    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.layers.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].key, "EC-123");
    assert.equal(result.skipped[0].inFlightDependency, true);
  });

  void it("sets inFlightDependency false when flag is absent", () => {
    const input = JSON.stringify({
      layers: [],
      skipped: [{ key: "EC-124", reason: "redundant with EC-100", redundantWith: "EC-100" }],
      excluded: [],
    });
    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.skipped[0].inFlightDependency, false);
  });

  void it("returns null for missing layers", () => {
    const input = JSON.stringify({ skipped: [] });
    assert.equal(parsePrioritizerOutput(input), null);
  });

  void it("returns null for invalid JSON", () => {
    assert.equal(parsePrioritizerOutput("not json"), null);
  });

  void it("defaults skipped and excluded when omitted", () => {
    const input = JSON.stringify({
      layers: [makeLayer(["EC-1"])],
    });

    const result = parsePrioritizerOutput(input)!;
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.excluded, []);
  });

  void it("parses many sequential single-ticket layers", () => {
    const input = JSON.stringify({
      layers: [makeLayer(["EC-10819"]), makeLayer(["EC-10820"]), makeLayer(["EC-10821"])],
      skipped: [],
      excluded: [{ key: "EC-10798", reason: "Pure container story" }],
    });

    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.layers.length, 3);
    assert.equal(result.excluded.length, 1);
  });

  void it("strips code fences without language tag", () => {
    const json = JSON.stringify({ layers: [makeLayer(["EC-1"])] });
    const input = "```\n" + json + "\n```";

    const result = parsePrioritizerOutput(input)!;
    assert.ok(result);
  });

  void it("handles leading/trailing whitespace from stdout", () => {
    const json = JSON.stringify({ layers: [makeLayer(["EC-1"])] });
    const input = "\n\n  " + json + "  \n\n";

    const result = parsePrioritizerOutput(input)!;
    assert.ok(result);
  });

  void it("parses depends_on field", () => {
    const input = JSON.stringify({
      layers: [
        {
          group: [
            {
              key: "EC-1",
              complexity: "moderate",
              repos: [{ repo: "acme-api", branch: "ec-1-fix" }],
            },
          ],
          relation: null,
          verification: { required: false, reason: "root" },
        },
        {
          group: [
            {
              key: "EC-2",
              complexity: "moderate",
              repos: [{ repo: "acme-api", branch: "ec-2-fix" }],
            },
          ],
          relation: null,
          verification: { required: true, reason: "depends on EC-1" },
          depends_on: "EC-1",
        },
      ],
    });

    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.layers[0].dependsOn, null);
    assert.equal(result.layers[1].dependsOn, "EC-1");
  });

  void it("defaults dependsOn to null when depends_on is absent", () => {
    const input = JSON.stringify({
      layers: [
        {
          group: [
            {
              key: "EC-1",
              complexity: "moderate",
              repos: [{ repo: "acme-api", branch: "ec-1-fix" }],
            },
          ],
          relation: null,
          verification: { required: false, reason: "test" },
        },
      ],
    });

    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.layers[0].dependsOn, null);
  });

  void it("parses repo assignments with branch names", () => {
    const input = JSON.stringify({
      layers: [
        {
          group: [
            {
              key: "EC-1",
              complexity: "moderate",
              repos: [{ repo: "acme-api", branch: "ec-1-fix-auth" }],
            },
            {
              key: "EC-2",
              repos: [
                { repo: "acme-api", branch: "ec-2-endpoint" },
                { repo: "acme-web", branch: "ec-2-ui" },
              ],
            },
          ],
          relation: "same-epic",
          verification: { required: true, reason: "EC-2 updates login page" },
        },
      ],
    });

    const result = parsePrioritizerOutput(input)!;
    assert.equal(result.layers[0].group.length, 2);
    assert.equal(result.layers[0].group[0].repos[0].repoPath, "acme-api");
    assert.equal(result.layers[0].group[0].repos[0].branch, "ec-1-fix-auth");
    assert.equal(result.layers[0].group[1].repos.length, 2);
    assert.equal(result.layers[0].verification.reason, "EC-2 updates login page");
  });
});

void describe("fallbackResult", () => {
  void it("wraps single ticket in one layer", () => {
    const result = fallbackResult(["EC-1"]);
    assert.equal(result.layers.length, 1);
    assert.deepEqual(result.layers[0].group, [{ key: "EC-1", complexity: "moderate", repos: [] }]);
    assert.equal(result.layers[0].verification.required, true);
    assert.equal(result.layers[0].verification.reason, "fallback — assuming verification needed");
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(result.excluded, []);
  });

  void it("wraps multiple tickets in one layer", () => {
    const result = fallbackResult(["EC-1", "EC-2", "EC-3"]);
    assert.deepEqual(result.layers[0].group, [
      { key: "EC-1", complexity: "moderate", repos: [] },
      { key: "EC-2", complexity: "moderate", repos: [] },
      { key: "EC-3", complexity: "moderate", repos: [] },
    ]);
    assert.equal(result.layers[0].relation, null);
  });

  void it("handles empty array", () => {
    const result = fallbackResult([]);
    assert.deepEqual(result.layers[0].group, []);
  });
});

void describe("classifyTickets", () => {
  void it("separates pending and context tickets", () => {
    const tickets = [
      { key: "EC-1", status: "To Do" },
      { key: "EC-2", status: "In Progress" },
      { key: "EC-3", status: "Backlog" },
      { key: "EC-4", status: "Done" },
    ];

    const { pending, context } = classifyTickets(tickets);
    assert.deepEqual(
      pending.map((t) => t.key),
      ["EC-1", "EC-3"],
    );
    assert.deepEqual(
      context.map((t) => t.key),
      ["EC-2", "EC-4"],
    );
  });

  void it("is case-insensitive for status matching", () => {
    const tickets = [
      { key: "EC-1", status: "TO DO" },
      { key: "EC-2", status: "backlog" },
    ];

    const { pending } = classifyTickets(tickets);
    assert.equal(pending.length, 2);
  });

  void it("returns all as context when no pending", () => {
    const tickets = [
      { key: "EC-1", status: "In Progress" },
      { key: "EC-2", status: "Done" },
    ];

    const { pending, context } = classifyTickets(tickets);
    assert.equal(pending.length, 0);
    assert.equal(context.length, 2);
  });

  void it("returns all as pending when all To Do/Backlog", () => {
    const tickets = [
      { key: "EC-1", status: "To Do" },
      { key: "EC-2", status: "Backlog" },
    ];

    const { pending, context } = classifyTickets(tickets);
    assert.equal(pending.length, 2);
    assert.equal(context.length, 0);
  });

  void it("handles empty input", () => {
    const { pending, context } = classifyTickets([]);
    assert.equal(pending.length, 0);
    assert.equal(context.length, 0);
  });

  void it("treats In Review, Closed, Resolved as context", () => {
    const tickets = [
      { key: "EC-1", status: "In Review" },
      { key: "EC-2", status: "Closed" },
      { key: "EC-3", status: "Resolved" },
      { key: "EC-4", status: "In Progress" },
    ];

    const { pending, context } = classifyTickets(tickets);
    assert.equal(pending.length, 0);
    assert.equal(context.length, 4);
  });
});

const ta = (key: string): TicketAssignment => ({ key, repos: [], complexity: "moderate" });

void describe("filterGroup", () => {
  const unprocessed = new Set(["EC-1", "EC-2", "EC-3", "EC-4"]);

  void it("filters to only unprocessed tickets", () => {
    const result = filterGroup(
      [ta("EC-1"), ta("EC-2"), ta("EC-5")],
      unprocessed,
      new Set(),
      new Set(),
    );
    assert.deepEqual(result, [ta("EC-1"), ta("EC-2")]);
  });

  void it("excludes skipped tickets", () => {
    const result = filterGroup(
      [ta("EC-1"), ta("EC-2"), ta("EC-3")],
      unprocessed,
      new Set(["EC-2"]),
      new Set(),
    );
    assert.deepEqual(result, [ta("EC-1"), ta("EC-3")]);
  });

  void it("excludes excluded tickets", () => {
    const result = filterGroup(
      [ta("EC-1"), ta("EC-2"), ta("EC-3")],
      unprocessed,
      new Set(),
      new Set(["EC-3"]),
    );
    assert.deepEqual(result, [ta("EC-1"), ta("EC-2")]);
  });

  void it("applies all filters together", () => {
    const result = filterGroup(
      [ta("EC-1"), ta("EC-2"), ta("EC-3"), ta("EC-4"), ta("EC-5")],
      unprocessed,
      new Set(["EC-2"]),
      new Set(["EC-4"]),
    );
    assert.deepEqual(result, [ta("EC-1"), ta("EC-3")]);
  });

  void it("returns empty when no tickets pass", () => {
    const result = filterGroup([ta("EC-5"), ta("EC-6")], unprocessed, new Set(), new Set());
    assert.deepEqual(result, []);
  });

  void it("handles empty group input", () => {
    const result = filterGroup([], unprocessed, new Set(), new Set());
    assert.deepEqual(result, []);
  });

  void it("passes through when all tickets are valid", () => {
    const result = filterGroup(
      [ta("EC-1"), ta("EC-2"), ta("EC-3")],
      unprocessed,
      new Set(),
      new Set(),
    );
    assert.deepEqual(result, [ta("EC-1"), ta("EC-2"), ta("EC-3")]);
  });

  void it("handles ticket in both skipped and excluded", () => {
    const result = filterGroup(
      [ta("EC-1"), ta("EC-2"), ta("EC-3")],
      unprocessed,
      new Set(["EC-2"]),
      new Set(["EC-2"]),
    );
    assert.deepEqual(result, [ta("EC-1"), ta("EC-3")]);
  });
});
