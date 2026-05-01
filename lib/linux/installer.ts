import { execSync } from "node:child_process";
import { exec } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type { AgentDef } from "../agents";
import { agentPersistentLogDir } from "../paths";
import { deployAgentScript, deployTriggerScript, copyNativePackages } from "../installer";
import { cronLabel, jobCronLabel, buildCronEntry } from "./cron-generate";
import type { ScheduledJob } from "../agents-config-schemas";

const execAsync = promisify(exec);

const CRON_TAG = "# dovepaw:";

async function readCrontab(): Promise<string> {
  try {
    const { stdout } = await execAsync("crontab -l");
    return stdout;
  } catch {
    return "";
  }
}

function writeCrontab(content: string): void {
  execSync("crontab -", { input: content, stdio: ["pipe", "inherit", "inherit"] });
}

function removeEntries(crontab: string, label: string): string {
  const tag = `${CRON_TAG}${label}`;
  const lines = crontab.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === tag) {
      i += 2; // skip comment line + cron line
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n");
}

function appendEntry(crontab: string, entry: string): string {
  const base = crontab.trimEnd();
  return base ? `${base}\n${entry}\n` : `${entry}\n`;
}

export async function isAgentLoaded(label: string): Promise<boolean> {
  const crontab = await readCrontab();
  return crontab.includes(`${CRON_TAG}${label}`);
}

export async function areAgentsLoaded(labels: string[]): Promise<Record<string, boolean>> {
  const crontab = await readCrontab();
  return Object.fromEntries(
    labels.map((label) => [label, crontab.includes(`${CRON_TAG}${label}`)]),
  );
}

export async function uninstallAgent(agent: AgentDef): Promise<void> {
  let crontab = await readCrontab();
  if (agent.scheduledJobs?.length) {
    for (const job of agent.scheduledJobs) {
      crontab = removeEntries(crontab, jobCronLabel(agent.name, job.id, job.label));
    }
  }
  crontab = removeEntries(crontab, cronLabel(agent));
  writeCrontab(crontab);
}

export async function removeJob(agentName: string, jobId: string, label?: string): Promise<void> {
  const tag = jobCronLabel(agentName, jobId, label);
  const crontab = await readCrontab();
  const updated = removeEntries(crontab, tag);
  if (updated !== crontab) writeCrontab(updated);
}

export async function installAgent(
  agent: AgentDef,
  nativePackages: string[],
): Promise<{ skipped: boolean }> {
  if (agent.schedulingEnabled === false) return { skipped: true };

  await Promise.all([
    deployAgentScript(agent.name),
    deployTriggerScript(),
    copyNativePackages(nativePackages),
  ]);

  await uninstallAgent(agent);

  const jobs: Array<{ label: string; job: ScheduledJob }> = agent.scheduledJobs?.length
    ? agent.scheduledJobs.map((job) => ({
        label: jobCronLabel(agent.name, job.id, job.label),
        job,
      }))
    : agent.schedule
      ? [
          {
            label: cronLabel(agent),
            job: {
              id: "default",
              label: "",
              schedule: agent.schedule,
              instruction: "",
              runAtLoad: agent.runAtLoad ?? false,
            },
          },
        ]
      : [];

  let crontab = await readCrontab();
  for (const { label, job } of jobs) {
    if (!job.schedule) continue;
    const jobId = agent.scheduledJobs?.length ? job.id : undefined;
    const entry = buildCronEntry(agent, job.schedule, label, process.execPath, jobId);
    crontab = appendEntry(crontab, entry);
  }
  writeCrontab(crontab);

  await mkdir(agentPersistentLogDir(agent.name), { recursive: true });

  return { skipped: false };
}
