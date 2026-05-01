import type { AgentDef } from "../agents";
import type { AgentSchedule } from "../agents-config-schemas";
import { A2A_TRIGGER_SCRIPT, agentPersistentLogDir } from "../paths";
import { slugifyJobLabel } from "../macos/plist-generate";

export function cronLabel(config: AgentDef): string {
  return `com.pixelpaw.scheduler.${config.name}`;
}

export function jobCronLabel(agentName: string, jobId: string, label?: string): string {
  const slug = label ? slugifyJobLabel(label) : "";
  return slug
    ? `com.pixelpaw.scheduler.${agentName}.${slug}.${jobId}`
    : `com.pixelpaw.scheduler.${agentName}.${jobId}`;
}

/** Convert an AgentSchedule to a crontab expression.
 *  interval: rounded to nearest minute (minimum 1).
 *  calendar: maps hour/minute/weekday directly.
 *  onetime: fires annually on the given date (crontab has no year field). */
export function toCronExpression(schedule: AgentSchedule): string {
  if (schedule.type === "interval") {
    const minutes = Math.max(1, Math.round(schedule.seconds / 60));
    return minutes === 1 ? "* * * * *" : `*/${minutes} * * * *`;
  }
  if (schedule.type === "calendar") {
    // ISO weekday: 1=Mon…7=Sun → cron: 1=Mon…6=Sat, 0=Sun (ISO 7 % 7 = 0)
    const weekday = schedule.weekday !== undefined ? String(schedule.weekday % 7) : "*";
    return `${schedule.minute} ${schedule.hour} * * ${weekday}`;
  }
  // onetime — year is display-only; fires annually on this date
  return `${schedule.minute} ${schedule.hour} ${schedule.day} ${schedule.month} *`;
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Build the full crontab entry (comment line + cron line) for one agent job.
 *  nodePath must be the full path to the node executable. */
export function buildCronEntry(
  agent: AgentDef,
  schedule: AgentSchedule,
  label: string,
  nodePath: string,
  jobId?: string,
): string {
  const logDir = agentPersistentLogDir(agent.name);
  const logFile = jobId ? `${logDir}/out.${jobId}.log` : `${logDir}/out.log`;
  const jobArg = jobId ? ` ${shellEscape(jobId)}` : "";
  const envVars = { ...agent.envVars, DOVEPAW_SCHEDULED: "1" };
  const envPrefix = Object.entries(envVars)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${shellEscape(v)}`)
    .join(" ");
  const cmd =
    `env ${envPrefix} ${shellEscape(nodePath)} ${shellEscape(A2A_TRIGGER_SCRIPT)} ` +
    `${shellEscape(agent.manifestKey)} ${shellEscape(agent.name)}${jobArg}` +
    ` >> ${shellEscape(logFile)} 2>&1`;
  return `# dovepaw:${label}\n${toCronExpression(schedule)} ${cmd}`;
}
