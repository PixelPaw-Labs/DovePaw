import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@@/lib/agents-config", () => ({
  readScheduledAgentsConfig: vi.fn(),
}));

vi.mock("@@/lib/a2a-trigger", () => ({
  triggerAgent: vi.fn().mockResolvedValue("completed"),
}));

vi.mock("@/a2a/lib/ports-manifest", () => ({
  readPortsManifest: vi.fn(),
}));

import { readScheduledAgentsConfig } from "@@/lib/agents-config";
import { triggerAgent } from "@@/lib/a2a-trigger";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import { InProcessScheduler } from "../in-process-scheduler";
import type { AgentDef } from "@@/lib/agents";
import type { PortsManifest } from "@/a2a/lib/ports-manifest";

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

function makeManifest(ports: Record<string, number>): PortsManifest {
  return { updatedAt: "2025-01-01T00:00:00.000Z", ...ports };
}

describe("InProcessScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(readPortsManifest).mockReturnValue(makeManifest({ test_agent: 1234 }));
    vi.mocked(triggerAgent).mockResolvedValue("completed");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ─── interval ────────────────────────────────────────────────────────────────

  describe("interval schedule", () => {
    it("fires at each interval", async () => {
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({ schedule: { type: "interval", seconds: 60 } }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();

      expect(triggerAgent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(triggerAgent).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(triggerAgent).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it("stops after stop()", async () => {
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({ schedule: { type: "interval", seconds: 60 } }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();
      scheduler.stop();

      await vi.advanceTimersByTimeAsync(120_000);
      expect(triggerAgent).not.toHaveBeenCalled();
    });

    it("passes instruction to triggerAgent", async () => {
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({
          scheduledJobs: [
            {
              id: "j1",
              label: "test",
              schedule: { type: "interval", seconds: 30 },
              instruction: "hello world",
              runAtLoad: false,
            },
          ],
        }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();
      await vi.advanceTimersByTimeAsync(30_000);

      expect(triggerAgent).toHaveBeenCalledWith(1234, "hello world");
      scheduler.stop();
    });
  });

  // ─── runAtLoad ───────────────────────────────────────────────────────────────

  describe("runAtLoad", () => {
    it("fires immediately on start", async () => {
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({ runAtLoad: true, schedule: { type: "interval", seconds: 3600 } }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();
      // Flush microtasks queued by void this.fireJob() without advancing timers
      await vi.advanceTimersByTimeAsync(0);

      expect(triggerAgent).toHaveBeenCalledTimes(1);
      scheduler.stop();
    });

    it("fires per-job runAtLoad independently of top-level runAtLoad", async () => {
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({
          scheduledJobs: [
            {
              id: "j1",
              label: "a",
              schedule: { type: "interval", seconds: 3600 },
              instruction: "job1",
              runAtLoad: true,
            },
            {
              id: "j2",
              label: "b",
              schedule: { type: "interval", seconds: 3600 },
              instruction: "job2",
              runAtLoad: false,
            },
          ],
        }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();
      await vi.advanceTimersByTimeAsync(0);

      expect(triggerAgent).toHaveBeenCalledTimes(1);
      expect(triggerAgent).toHaveBeenCalledWith(1234, "job1");
      scheduler.stop();
    });
  });

  // ─── onetime ─────────────────────────────────────────────────────────────────

  describe("onetime schedule", () => {
    it("fires at the specified date/time", async () => {
      vi.setSystemTime(new Date(2025, 0, 1, 9, 0, 0)); // 09:00

      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({
          scheduledJobs: [
            {
              id: "j1",
              label: "once",
              schedule: { type: "onetime", year: 2025, month: 1, day: 1, hour: 10, minute: 0 },
              instruction: "do it once",
              runAtLoad: false,
            },
          ],
        }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();

      expect(triggerAgent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // +1 hour → 10:00
      expect(triggerAgent).toHaveBeenCalledOnce();
      expect(triggerAgent).toHaveBeenCalledWith(1234, "do it once");

      // Should not fire again
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(triggerAgent).toHaveBeenCalledOnce();

      scheduler.stop();
    });

    it("skips past-due onetime jobs on startup", async () => {
      vi.setSystemTime(new Date(2025, 0, 1, 11, 0, 0)); // 11:00 — after job time

      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({
          scheduledJobs: [
            {
              id: "j1",
              label: "once",
              schedule: { type: "onetime", year: 2025, month: 1, day: 1, hour: 10, minute: 0 },
              instruction: "do it once",
              runAtLoad: false,
            },
          ],
        }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();

      expect(triggerAgent).not.toHaveBeenCalled();
      scheduler.stop();
    });
  });

  // ─── calendar ────────────────────────────────────────────────────────────────

  describe("calendar schedule", () => {
    it("fires at the configured daily time and re-arms", async () => {
      vi.setSystemTime(new Date(2025, 0, 1, 8, 0, 0)); // 08:00

      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({ schedule: { type: "calendar", hour: 9, minute: 0 } }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();

      expect(triggerAgent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // +1h → 09:00
      expect(triggerAgent).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // +24h
      expect(triggerAgent).toHaveBeenCalledTimes(2);

      scheduler.stop();
    });

    it("waits until next day when daily time already passed today", async () => {
      vi.setSystemTime(new Date(2025, 0, 1, 10, 0, 0)); // 10:00 — already past 09:00

      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({ schedule: { type: "calendar", hour: 9, minute: 0 } }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();

      // Should not fire for the rest of today
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000); // +1h (11:00)
      expect(triggerAgent).not.toHaveBeenCalled();

      // Should fire ~23h from 10:00 when next 09:00 arrives
      await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000); // +23h (next day 09:00)
      expect(triggerAgent).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });
  });

  // ─── scheduledJobs precedence ────────────────────────────────────────────────

  describe("scheduledJobs vs top-level schedule", () => {
    it("uses scheduledJobs when both are present", async () => {
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({
          schedule: { type: "interval", seconds: 60 }, // should be ignored
          scheduledJobs: [
            {
              id: "j1",
              label: "",
              schedule: { type: "interval", seconds: 300 },
              instruction: "",
              runAtLoad: false,
            },
          ],
        }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();

      await vi.advanceTimersByTimeAsync(60_000); // 60s — top-level would have fired
      expect(triggerAgent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(240_000); // total 300s — scheduledJob fires
      expect(triggerAgent).toHaveBeenCalledTimes(1);

      scheduler.stop();
    });
  });

  // ─── missing port ─────────────────────────────────────────────────────────────

  describe("port not available", () => {
    it("skips firing when manifest is null", async () => {
      vi.mocked(readPortsManifest).mockReturnValue(null);
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({ schedule: { type: "interval", seconds: 60 } }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(triggerAgent).not.toHaveBeenCalled();
      scheduler.stop();
    });

    it("skips firing when agent port is missing from manifest", async () => {
      vi.mocked(readPortsManifest).mockReturnValue(makeManifest({ other_agent: 9999 }));
      vi.mocked(readScheduledAgentsConfig).mockResolvedValue([
        makeAgent({ schedule: { type: "interval", seconds: 60 } }),
      ]);

      const scheduler = new InProcessScheduler();
      await scheduler.start();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(triggerAgent).not.toHaveBeenCalled();
      scheduler.stop();
    });
  });
});
