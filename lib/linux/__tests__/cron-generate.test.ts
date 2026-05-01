import { describe, expect, it } from "vitest";
import { cronLabel, jobCronLabel, toCronExpression, buildCronEntry } from "../cron-generate";
import type { AgentDef } from "@@/lib/agents";

function makeAgent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    name: "test-agent",
    alias: "ta",
    entryPath: "agents/test-agent/main.ts",
    displayName: "Test Agent",
    label: "Test Agent",
    manifestKey: "test_agent",
    toolName: "yolo_test_agent",
    description: "A test agent",
    icon: (() => null) as unknown as AgentDef["icon"],
    iconBg: "",
    iconColor: "",
    doveCard: {
      icon: (() => null) as unknown as AgentDef["icon"],
      iconBg: "",
      iconColor: "",
      title: "",
      description: "",
      prompt: "",
    },
    suggestions: [],
    ...overrides,
  } as AgentDef;
}

describe("cronLabel", () => {
  it("returns com.pixelpaw.scheduler.<name>", () => {
    expect(cronLabel(makeAgent())).toBe("com.pixelpaw.scheduler.test-agent");
  });
});

describe("jobCronLabel", () => {
  it("includes slug when label is provided", () => {
    expect(jobCronLabel("test-agent", "abc123", "Daily Report")).toBe(
      "com.pixelpaw.scheduler.test-agent.daily-report.abc123",
    );
  });

  it("omits slug when label is absent", () => {
    expect(jobCronLabel("test-agent", "abc123")).toBe("com.pixelpaw.scheduler.test-agent.abc123");
  });
});

describe("toCronExpression", () => {
  describe("interval", () => {
    it("60s → * * * * *", () => {
      expect(toCronExpression({ type: "interval", seconds: 60 })).toBe("* * * * *");
    });

    it("120s → */2 * * * *", () => {
      expect(toCronExpression({ type: "interval", seconds: 120 })).toBe("*/2 * * * *");
    });

    it("3600s → */60 * * * *", () => {
      expect(toCronExpression({ type: "interval", seconds: 3600 })).toBe("*/60 * * * *");
    });

    it("sub-minute (30s) → * * * * * (minimum 1 minute)", () => {
      expect(toCronExpression({ type: "interval", seconds: 30 })).toBe("* * * * *");
    });

    it("90s rounds to */2 * * * *", () => {
      expect(toCronExpression({ type: "interval", seconds: 90 })).toBe("*/2 * * * *");
    });
  });

  describe("calendar", () => {
    it("daily at 09:00 → 0 9 * * *", () => {
      expect(toCronExpression({ type: "calendar", hour: 9, minute: 0 })).toBe("0 9 * * *");
    });

    it("weekly on Monday (ISO 1) → 0 9 * * 1", () => {
      expect(toCronExpression({ type: "calendar", hour: 9, minute: 0, weekday: 1 })).toBe(
        "0 9 * * 1",
      );
    });

    it("weekly on Sunday (ISO 7) → 0 9 * * 0", () => {
      expect(toCronExpression({ type: "calendar", hour: 9, minute: 0, weekday: 7 })).toBe(
        "0 9 * * 0",
      );
    });

    it("weekly on Saturday (ISO 6) → 0 9 * * 6", () => {
      expect(toCronExpression({ type: "calendar", hour: 9, minute: 0, weekday: 6 })).toBe(
        "0 9 * * 6",
      );
    });
  });

  describe("onetime", () => {
    it("maps to minute hour day month * (year ignored)", () => {
      expect(
        toCronExpression({ type: "onetime", year: 2025, month: 6, day: 15, hour: 10, minute: 30 }),
      ).toBe("30 10 15 6 *");
    });
  });
});

describe("buildCronEntry", () => {
  it("includes the dovepaw label comment", () => {
    const agent = makeAgent();
    const entry = buildCronEntry(
      agent,
      { type: "calendar", hour: 9, minute: 0 },
      "com.pixelpaw.scheduler.test-agent",
      "/usr/bin/node",
    );
    expect(entry).toContain("# dovepaw:com.pixelpaw.scheduler.test-agent");
  });

  it("includes DOVEPAW_SCHEDULED=1 in env", () => {
    const agent = makeAgent();
    const entry = buildCronEntry(
      agent,
      { type: "calendar", hour: 9, minute: 0 },
      "com.pixelpaw.scheduler.test-agent",
      "/usr/bin/node",
    );
    expect(entry).toContain("DOVEPAW_SCHEDULED='1'");
  });

  it("includes the cron expression on the command line", () => {
    const agent = makeAgent();
    const entry = buildCronEntry(
      agent,
      { type: "calendar", hour: 9, minute: 0 },
      "com.pixelpaw.scheduler.test-agent",
      "/usr/bin/node",
    );
    expect(entry).toContain("0 9 * * *");
  });

  it("includes jobId arg when provided", () => {
    const agent = makeAgent();
    const entry = buildCronEntry(
      agent,
      { type: "interval", seconds: 3600 },
      "com.pixelpaw.scheduler.test-agent.j1",
      "/usr/bin/node",
      "j1",
    );
    expect(entry).toContain("'j1'");
  });

  it("includes agent envVars in the command", () => {
    const agent = makeAgent({ envVars: { MY_KEY: "myvalue" } });
    const entry = buildCronEntry(
      agent,
      { type: "calendar", hour: 9, minute: 0 },
      "com.pixelpaw.scheduler.test-agent",
      "/usr/bin/node",
    );
    expect(entry).toContain("MY_KEY='myvalue'");
  });
});
