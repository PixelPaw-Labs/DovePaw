import type { AgentDef } from "../agents";
import type { AgentSchedule, ScheduledJob } from "../agents-config-schemas";
import { A2A_TRIGGER_SCRIPT, agentPersistentLogDir } from "../paths";

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function scheduleBlock(schedule: AgentSchedule | undefined): string {
  if (!schedule) return "";

  if (schedule.type === "interval") {
    return ["    <key>StartInterval</key>", `    <integer>${schedule.seconds}</integer>`].join(
      "\n",
    );
  }

  if (schedule.type === "onetime") {
    const entries = [
      "        <key>Month</key>",
      `        <integer>${schedule.month}</integer>`,
      "        <key>Day</key>",
      `        <integer>${schedule.day}</integer>`,
      "        <key>Hour</key>",
      `        <integer>${schedule.hour}</integer>`,
      "        <key>Minute</key>",
      `        <integer>${schedule.minute}</integer>`,
    ];
    return ["    <key>StartCalendarInterval</key>", "    <dict>", ...entries, "    </dict>"].join(
      "\n",
    );
  }

  // calendar
  const entries = [
    "        <key>Hour</key>",
    `        <integer>${schedule.hour}</integer>`,
    "        <key>Minute</key>",
    `        <integer>${schedule.minute}</integer>`,
  ];

  if (schedule.weekday !== undefined) {
    // ISO weekday: 1=Mon…7=Sun → launchd: 0=Sun…6=Sat
    const launchdWeekday = schedule.weekday % 7;
    entries.push("        <key>Weekday</key>", `        <integer>${launchdWeekday}</integer>`);
  }

  return ["    <key>StartCalendarInterval</key>", "    <dict>", ...entries, "    </dict>"].join(
    "\n",
  );
}

function envVarsBlock(envVars: Record<string, string>): string {
  const entries = Object.entries(envVars)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .flatMap(([k, v]) => [
      `        <key>${escapeXml(k)}</key>`,
      `        <string>${escapeXml(v)}</string>`,
    ]);

  return ["    <key>EnvironmentVariables</key>", "    <dict>", ...entries, "    </dict>"].join(
    "\n",
  );
}

function shellCommand(
  nodePath: string,
  manifestKey: string,
  agentName: string,
  jobId?: string,
): string {
  const asdfSh = "/opt/homebrew/opt/asdf/libexec/asdf.sh";
  const jobArg = jobId ? ` '${jobId}'` : "";
  return escapeXml(
    `[ -f '${asdfSh}' ] && . '${asdfSh}'; exec '${nodePath}' '${A2A_TRIGGER_SCRIPT}' '${manifestKey}' '${agentName}'${jobArg}`,
  );
}

/** Returns the launchd service label and plist filename stem: "com.pixelpaw.scheduler.<name>" */
export function plistLabel(config: AgentDef): string {
  return `com.pixelpaw.scheduler.${config.name}`;
}

export function slugifyJobLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Returns the plist label for a job: "com.pixelpaw.scheduler.<agentName>.<label-slug>.<jobId>" */
export function jobPlistLabel(agentName: string, jobId: string, label?: string): string {
  const slug = label ? slugifyJobLabel(label) : "";
  return slug
    ? `com.pixelpaw.scheduler.${agentName}.${slug}.${jobId}`
    : `com.pixelpaw.scheduler.${agentName}.${jobId}`;
}

export function generatePlist(config: AgentDef, home: string): string {
  const nodePath = `${home}/.asdf/shims/node`;
  const logDir = agentPersistentLogDir(config.name);
  const runAtLoad = config.runAtLoad ?? false;

  const sections: string[] = [];

  // EnvironmentVariables — always inject DOVEPAW_SCHEDULED=1 so the agent
  // can distinguish launchd-triggered runs from A2A tool-triggered runs.
  const envVars = { ...config.envVars, DOVEPAW_SCHEDULED: "1" };
  sections.push(envVarsBlock(envVars));

  // Label
  sections.push("    <key>Label</key>", `    <string>${escapeXml(plistLabel(config))}</string>`);

  // ProcessType
  sections.push("    <key>ProcessType</key>", "    <string>Interactive</string>");

  // ProgramArguments
  const programArgs = [
    "        <string>/bin/zsh</string>",
    "        <string>-l</string>",
    "        <string>-c</string>",
    `        <string>${shellCommand(nodePath, config.manifestKey, config.name)}</string>`,
  ];
  sections.push("    <key>ProgramArguments</key>", "    <array>", ...programArgs, "    </array>");

  // RunAtLoad
  sections.push("    <key>RunAtLoad</key>", `    <${runAtLoad}/>`);

  // StandardErrorPath / StandardOutPath
  sections.push(
    "    <key>StandardErrorPath</key>",
    `    <string>${logDir}/err.log</string>`,
    "    <key>StandardOutPath</key>",
    `    <string>${logDir}/out.log</string>`,
  );

  // Schedule (optional)
  const schedule = scheduleBlock(config.schedule);
  if (schedule) {
    sections.push(schedule);
  }

  // WorkingDirectory
  sections.push("    <key>WorkingDirectory</key>", `    <string>${home}</string>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${sections.join("\n")}
</dict>
</plist>
`;
}

export function generateJobPlist(config: AgentDef, job: ScheduledJob, home: string): string {
  const nodePath = `${home}/.asdf/shims/node`;
  const logDir = agentPersistentLogDir(config.name);
  const label = jobPlistLabel(config.name, job.id, job.label);
  const runAtLoad = job.runAtLoad ?? false;

  const sections: string[] = [];

  const envVars: Record<string, string> = {
    ...config.envVars,
    DOVEPAW_SCHEDULED: "1",
  };
  sections.push(envVarsBlock(envVars));

  sections.push("    <key>Label</key>", `    <string>${escapeXml(label)}</string>`);

  sections.push("    <key>ProcessType</key>", "    <string>Interactive</string>");

  const programArgs = [
    "        <string>/bin/zsh</string>",
    "        <string>-l</string>",
    "        <string>-c</string>",
    `        <string>${shellCommand(nodePath, config.manifestKey, config.name, job.id)}</string>`,
  ];
  sections.push("    <key>ProgramArguments</key>", "    <array>", ...programArgs, "    </array>");

  sections.push("    <key>RunAtLoad</key>", `    <${runAtLoad}/>`);

  sections.push(
    "    <key>StandardErrorPath</key>",
    `    <string>${logDir}/err.${job.id}.log</string>`,
    "    <key>StandardOutPath</key>",
    `    <string>${logDir}/out.${job.id}.log</string>`,
  );

  const schedule = scheduleBlock(job.schedule);
  if (schedule) {
    sections.push(schedule);
  }

  sections.push("    <key>WorkingDirectory</key>", `    <string>${home}</string>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${sections.join("\n")}
</dict>
</plist>
`;
}
