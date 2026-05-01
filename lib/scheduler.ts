/**
 * Platform-neutral scheduler abstraction — strategy pattern.
 *
 * SchedulerPlatform defines the interface; MacosSchedulerPlatform and
 * LinuxSchedulerPlatform implement it. The exported `scheduler` constant
 * is the active platform instance. All consumers import from here —
 * never directly from lib/macos/ or lib/linux/.
 */

import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { consola } from "consola";
import type { AgentDef } from "./agents";
import type { ScheduledJob } from "./agents-config-schemas";
import * as macosInstaller from "./macos/installer";
import * as linuxInstaller from "./linux/installer";
import { plistLabel, jobPlistLabel } from "./macos/plist-generate";
import { cronLabel, jobCronLabel } from "./linux/cron-generate";
import { LAUNCH_AGENTS_DIR } from "./macos/launchd-paths";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface AgentStatusDetail {
  state: string | null;
  pid: string | null;
  lastExitCode: string | null;
  raw: string;
}

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SchedulerPlatform {
  /** Primary scheduler label for an agent. */
  agentLabel(agent: AgentDef): string;
  /** Scheduler label for a specific scheduled job. */
  jobLabel(agentName: string, jobId: string, label?: string): string;
  /** Filesystem path to the scheduler config file for a label, or "" if not applicable. */
  configFilePath(label: string): string;
  /** Install and activate all scheduled jobs for an agent. */
  installAgent(agent: AgentDef, nativePackages: string[]): Promise<{ skipped: boolean }>;
  /** Uninstall all scheduled jobs for an agent. */
  uninstallAgent(agent: AgentDef): Promise<void>;
  /** Bootstrap (load/activate) an agent without reinstalling. */
  loadAgent(agent: AgentDef): Promise<void>;
  /** Bootout (unload/deactivate) an agent without removing its config. */
  unloadAgent(agent: AgentDef): Promise<void>;
  /** Return state, pid, and last exit code for an agent. */
  getAgentStatus(agent: AgentDef): Promise<AgentStatusDetail>;
  /** Check whether a single scheduler entry is active. */
  isAgentLoaded(label: string): Promise<boolean>;
  /** Check multiple scheduler entries in one call. */
  areAgentsLoaded(labels: string[]): Promise<Record<string, boolean>>;
  /** Filesystem dirs the scheduler uses — for agent additionalDirectories. */
  getSchedulerDirs(): string[];
  /** Unload and remove a single onetime job after it has fired. */
  cleanupOnetimeJob(agentName: string, jobId: string, label?: string): Promise<void>;
  /** Write the primary scheduler config for an agent (no-op if not applicable). */
  writeAgentConfig(agent: AgentDef): Promise<void>;
  /** Write scheduler config for a specific job. */
  writeJobConfig(agent: AgentDef, job: ScheduledJob): Promise<void>;
  /** Remove scheduler config for a specific job. */
  removeJobConfig(agent: AgentDef, job: ScheduledJob): Promise<void>;
  /** Activate a specific job without reinstalling the whole agent. */
  activateJob(agent: AgentDef, job: ScheduledJob): Promise<void>;
  /** Deactivate a specific job without removing its config. */
  deactivateJob(agent: AgentDef, job: ScheduledJob): Promise<void>;
}

// ─── macOS implementation ─────────────────────────────────────────────────────

class MacosSchedulerPlatform implements SchedulerPlatform {
  private readonly uid = macosInstaller.getUid();

  agentLabel(agent: AgentDef): string {
    return plistLabel(agent);
  }

  jobLabel(agentName: string, jobId: string, label?: string): string {
    return jobPlistLabel(agentName, jobId, label);
  }

  installAgent(agent: AgentDef, nativePackages: string[]): Promise<{ skipped: boolean }> {
    return macosInstaller.installAgent(agent, this.uid, nativePackages);
  }

  uninstallAgent(agent: AgentDef): Promise<void> {
    return macosInstaller.uninstallAgent(agent, this.uid);
  }

  loadAgent(agent: AgentDef): Promise<void> {
    return macosInstaller.loadAgent(agent, this.uid);
  }

  unloadAgent(agent: AgentDef): Promise<void> {
    return macosInstaller.unloadAgent(agent, this.uid);
  }

  getAgentStatus(agent: AgentDef): Promise<AgentStatusDetail> {
    return macosInstaller.getAgentStatus(agent, this.uid);
  }

  isAgentLoaded(label: string): Promise<boolean> {
    return macosInstaller.isAgentLoaded(label);
  }

  areAgentsLoaded(labels: string[]): Promise<Record<string, boolean>> {
    return macosInstaller.areAgentsLoaded(labels);
  }

  getSchedulerDirs(): string[] {
    return [LAUNCH_AGENTS_DIR];
  }

  configFilePath(label: string): string {
    return join(LAUNCH_AGENTS_DIR, `${label}.plist`);
  }

  writeAgentConfig(agent: AgentDef): Promise<void> {
    return macosInstaller.writePlistFile(agent);
  }

  writeJobConfig(agent: AgentDef, job: ScheduledJob): Promise<void> {
    return macosInstaller.writeJobPlistFile(agent, job);
  }

  removeJobConfig(agent: AgentDef, job: ScheduledJob): Promise<void> {
    return macosInstaller.removeJobPlistFile(agent, job);
  }

  activateJob(agent: AgentDef, job: ScheduledJob): Promise<void> {
    return macosInstaller.loadJobPlist(agent, job, this.uid);
  }

  deactivateJob(agent: AgentDef, job: ScheduledJob): Promise<void> {
    return macosInstaller.unloadJobPlist(agent, job, this.uid);
  }

  async cleanupOnetimeJob(agentName: string, jobId: string, label?: string): Promise<void> {
    const labelStr = jobPlistLabel(agentName, jobId, label);
    const plistPath = join(LAUNCH_AGENTS_DIR, `${labelStr}.plist`);
    try {
      execSync(`launchctl bootout gui/${this.uid} '${plistPath}'`, { stdio: "ignore" });
    } catch (err) {
      consola.warn(`[scheduler] launchctl bootout failed for "${labelStr}"`, err);
    }
    try {
      if (existsSync(plistPath)) unlinkSync(plistPath);
    } catch (err) {
      consola.warn(`[scheduler] Could not remove plist "${plistPath}"`, err);
    }
  }
}

// ─── Linux implementation ─────────────────────────────────────────────────────

class LinuxSchedulerPlatform implements SchedulerPlatform {
  agentLabel(agent: AgentDef): string {
    return cronLabel(agent);
  }

  jobLabel(agentName: string, jobId: string, label?: string): string {
    return jobCronLabel(agentName, jobId, label);
  }

  installAgent(agent: AgentDef, nativePackages: string[]): Promise<{ skipped: boolean }> {
    return linuxInstaller.installAgent(agent, nativePackages);
  }

  uninstallAgent(agent: AgentDef): Promise<void> {
    return linuxInstaller.uninstallAgent(agent);
  }

  async loadAgent(_agent: AgentDef): Promise<void> {
    // crontab entries are always active once installed — no separate load step
  }

  async unloadAgent(_agent: AgentDef): Promise<void> {
    // crontab entries are always active once installed — no separate unload step
  }

  async getAgentStatus(agent: AgentDef): Promise<AgentStatusDetail> {
    const loaded = await linuxInstaller.isAgentLoaded(this.agentLabel(agent));
    return { state: loaded ? "waiting" : "disabled", pid: null, lastExitCode: null, raw: "" };
  }

  isAgentLoaded(label: string): Promise<boolean> {
    return linuxInstaller.isAgentLoaded(label);
  }

  areAgentsLoaded(labels: string[]): Promise<Record<string, boolean>> {
    return linuxInstaller.areAgentsLoaded(labels);
  }

  getSchedulerDirs(): string[] {
    return []; // crontab has no filesystem directory
  }

  configFilePath(_label: string): string {
    return ""; // crontab has no config file on disk
  }

  async writeAgentConfig(_agent: AgentDef): Promise<void> {}

  async writeJobConfig(_agent: AgentDef, _job: ScheduledJob): Promise<void> {}

  async removeJobConfig(agent: AgentDef, job: ScheduledJob): Promise<void> {
    await linuxInstaller.removeJob(agent.name, job.id, job.label);
  }

  async activateJob(_agent: AgentDef, _job: ScheduledJob): Promise<void> {}

  async deactivateJob(_agent: AgentDef, _job: ScheduledJob): Promise<void> {}

  async cleanupOnetimeJob(agentName: string, jobId: string, label?: string): Promise<void> {
    await linuxInstaller.removeJob(agentName, jobId, label);
  }
}

// ─── Active platform ──────────────────────────────────────────────────────────

export const scheduler: SchedulerPlatform =
  process.platform === "linux" ? new LinuxSchedulerPlatform() : new MacosSchedulerPlatform();
