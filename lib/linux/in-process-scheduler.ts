/**
 * Cross-platform in-process scheduler.
 *
 * Alternative to macOS launchd: reads scheduled agent config at start, then
 * fires each job via the A2A server using the same triggerAgent path as the
 * launchd trigger script.  Port manifest is read lazily at fire time so the
 * scheduler can start before A2A servers are listening.
 *
 * Schedule types:
 *   interval  → setInterval
 *   calendar  → setTimeout to next occurrence, re-arms after each fire
 *   onetime   → single setTimeout; past-due jobs are skipped on startup
 */

import { consola } from "consola";
import type { AgentDef } from "@@/lib/agents";
import { readScheduledAgentsConfig } from "@@/lib/agents-config";
import type { AgentSchedule } from "@@/lib/agents-config-schemas";
import { triggerAgent } from "@@/lib/a2a-trigger";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";

// ─── Calendar helpers ─────────────────────────────────────────────────────────

function msUntilNextCalendar(
  schedule: Extract<AgentSchedule, { type: "calendar" }>,
  now: Date,
): number {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(schedule.hour);
  next.setMinutes(schedule.minute);

  if (schedule.weekday !== undefined) {
    // ISO weekday: 1=Mon … 7=Sun. JS Date.getDay(): 0=Sun … 6=Sat
    const targetJs = schedule.weekday === 7 ? 0 : schedule.weekday;
    const currentJs = now.getDay();
    let daysUntil = (targetJs - currentJs + 7) % 7;
    if (daysUntil === 0 && next.getTime() <= now.getTime()) daysUntil = 7;
    next.setDate(next.getDate() + daysUntil);
  } else if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - now.getTime();
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export class InProcessScheduler {
  private readonly intervals: ReturnType<typeof setInterval>[] = [];
  private readonly timeouts: ReturnType<typeof setTimeout>[] = [];
  private stopped = false;

  async start(): Promise<void> {
    const agents = await readScheduledAgentsConfig();
    const now = new Date();
    for (const agent of agents) {
      this.scheduleAgent(agent, now);
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.intervals) clearInterval(t);
    for (const t of this.timeouts) clearTimeout(t);
    this.intervals.length = 0;
    this.timeouts.length = 0;
  }

  private scheduleAgent(agent: AgentDef, now: Date): void {
    // scheduledJobs[] takes precedence over top-level schedule when both present
    const jobs =
      agent.scheduledJobs && agent.scheduledJobs.length > 0
        ? agent.scheduledJobs
        : agent.schedule
          ? [
              {
                id: "default",
                label: "",
                schedule: agent.schedule,
                instruction: "",
                runAtLoad: agent.runAtLoad ?? false,
              },
            ]
          : [];

    for (const job of jobs) {
      if (job.runAtLoad) {
        void this.fireJob(agent, job.instruction);
      }
      if (!job.schedule) continue;
      this.armJob(agent, job.instruction, job.schedule, now);
    }
  }

  private armJob(agent: AgentDef, instruction: string, schedule: AgentSchedule, now: Date): void {
    if (schedule.type === "interval") {
      this.intervals.push(
        setInterval(() => {
          if (!this.stopped) void this.fireJob(agent, instruction);
        }, schedule.seconds * 1000),
      );
    } else if (schedule.type === "calendar") {
      this.armCalendar(agent, instruction, schedule, now);
    } else if (schedule.type === "onetime") {
      const fireAt = new Date(
        schedule.year,
        schedule.month - 1,
        schedule.day,
        schedule.hour,
        schedule.minute,
        0,
      );
      const delay = fireAt.getTime() - now.getTime();
      if (delay <= 0) {
        consola.info(`[scheduler] Skipping past-due onetime job for ${agent.name}`);
        return;
      }
      this.timeouts.push(
        setTimeout(() => {
          if (!this.stopped) void this.fireJob(agent, instruction);
        }, delay),
      );
    }
  }

  private armCalendar(
    agent: AgentDef,
    instruction: string,
    schedule: Extract<AgentSchedule, { type: "calendar" }>,
    now: Date,
  ): void {
    const delay = msUntilNextCalendar(schedule, now);
    this.timeouts.push(
      setTimeout(() => {
        if (this.stopped) return;
        void this.fireJob(agent, instruction);
        this.armCalendar(agent, instruction, schedule, new Date());
      }, delay),
    );
  }

  private async fireJob(agent: AgentDef, instruction: string): Promise<void> {
    const manifest = readPortsManifest();
    if (!manifest) {
      consola.warn(`[scheduler] Port manifest unavailable — skipping ${agent.manifestKey}`);
      return;
    }
    const port = manifest[agent.manifestKey];
    if (typeof port !== "number") {
      consola.warn(`[scheduler] No port for ${agent.manifestKey} — skipping`);
      return;
    }
    consola.info(`[scheduler] Firing ${agent.displayName}`);
    try {
      await triggerAgent(port, instruction);
    } catch (err) {
      consola.error(`[scheduler] Error firing ${agent.manifestKey}:`, err);
    }
  }
}
