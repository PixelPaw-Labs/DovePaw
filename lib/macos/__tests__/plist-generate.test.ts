import { describe, expect, it } from "vitest";
import { generatePlist, generateJobPlist, jobPlistLabel, plistLabel } from "../plist-generate";
import type { AgentDef } from "@@/lib/agents";
import type { ScheduledJob } from "@@/lib/agents-config-schemas";
import { Brain } from "lucide-react";

const BASE: AgentDef = {
  name: "test-agent",
  alias: "ta",
  entryPath: "agents/test-agent/index.ts",
  displayName: "Test Agent",
  label: "Claude Code Agent - Test Agent",
  manifestKey: "test_agent",
  toolName: "run_test_agent",
  description: "A test agent",
  schedule: { type: "calendar", hour: 9, minute: 0 },
  icon: Brain,
  iconBg: "",
  iconColor: "",
  doveCard: {
    icon: Brain,
    iconBg: "",
    iconColor: "",
    title: "Test Agent",
    description: "",
    prompt: "",
  },
  suggestions: [],
};

const HOME = "/Users/test";

describe("plistLabel", () => {
  it("uses the agent name as the filename stem", () => {
    expect(plistLabel(BASE)).toBe("com.pixelpaw.scheduler.test-agent");
  });
});

describe("generatePlist — ProgramArguments", () => {
  it("does not include a '--' separator", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).not.toContain("<string>--</string>");
  });

  it("does not include '$@' in the shell command", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).not.toContain('"$@"');
  });

  it("does not source the env script (settings resolved at runtime by QueryAgentExecutor)", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).not.toContain("env.sh");
  });

  it("runs a2a-trigger.mjs with the agent manifestKey and agentName", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain("a2a-trigger.mjs");
    expect(plist).toContain(BASE.manifestKey);
    expect(plist).toContain(BASE.name);
  });
});

describe("generatePlist — structure", () => {
  it("sets ProcessType to Interactive", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain("<string>Interactive</string>");
  });

  it("uses the reverse-DNS plist label as the plist Label key", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain(`<string>${plistLabel(BASE)}</string>`);
  });

  it("includes log paths under the agent log dir", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain(".test-agent/err.log");
    expect(plist).toContain(".test-agent/out.log");
  });

  it("embeds static envVars when provided", () => {
    const agent: AgentDef = { ...BASE, envVars: { FOO: "bar", BAZ: "qux" } };
    const plist = generatePlist(agent, HOME);
    expect(plist).toContain("<key>FOO</key>");
    expect(plist).toContain("<string>bar</string>");
  });

  it("always injects DOVEPAW_SCHEDULED=1 even when no envVars defined", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain("<key>DOVEPAW_SCHEDULED</key>");
    expect(plist).toContain("<string>1</string>");
  });

  it("injects DOVEPAW_SCHEDULED=1 alongside agent-specific envVars", () => {
    const agent: AgentDef = { ...BASE, envVars: { FOO: "bar" } };
    const plist = generatePlist(agent, HOME);
    expect(plist).toContain("<key>DOVEPAW_SCHEDULED</key>");
    expect(plist).toContain("<key>FOO</key>");
    expect(plist).toContain("<string>bar</string>");
  });
});

describe("generatePlist — ISO weekday → launchd conversion", () => {
  it("converts Mon (ISO 1) to launchd 1", () => {
    const agent: AgentDef = {
      ...BASE,
      schedule: { type: "calendar", hour: 9, minute: 0, weekday: 1 },
    };
    const plist = generatePlist(agent, HOME);
    expect(plist).toContain("<key>Weekday</key>");
    expect(plist).toContain("<integer>1</integer>");
  });

  it("converts Sat (ISO 6) to launchd 6", () => {
    const agent: AgentDef = {
      ...BASE,
      schedule: { type: "calendar", hour: 9, minute: 0, weekday: 6 },
    };
    const plist = generatePlist(agent, HOME);
    expect(plist).toContain("<integer>6</integer>");
  });

  it("converts Sun (ISO 7) to launchd 0", () => {
    const agent: AgentDef = {
      ...BASE,
      schedule: { type: "calendar", hour: 12, minute: 0, weekday: 7 },
    };
    const plist = generatePlist(agent, HOME);
    expect(plist).toContain("<key>Weekday</key>");
    expect(plist).toContain("<integer>0</integer>");
  });

  it("omits Weekday key when weekday is not set", () => {
    const agent: AgentDef = {
      ...BASE,
      schedule: { type: "calendar", hour: 9, minute: 0 },
    };
    const plist = generatePlist(agent, HOME);
    expect(plist).not.toContain("<key>Weekday</key>");
  });
});

describe("jobPlistLabel", () => {
  it("returns com.pixelpaw.scheduler.<name>.<id> when no label", () => {
    expect(jobPlistLabel("my-agent", "abc12345")).toBe("com.pixelpaw.scheduler.my-agent.abc12345");
  });

  it("includes slugified label when provided", () => {
    expect(jobPlistLabel("my-agent", "abc12345", "Nightly dream")).toBe(
      "com.pixelpaw.scheduler.my-agent.nightly-dream.abc12345",
    );
  });
});

const BASE_JOB: ScheduledJob = {
  id: "abc12345",
  label: "",
  instruction: "",
};

describe("generateJobPlist — label", () => {
  it("uses jobPlistLabel as the plist Label key", () => {
    const plist = generateJobPlist(BASE, BASE_JOB, HOME);
    expect(plist).toContain(`<string>${jobPlistLabel(BASE.name, BASE_JOB.id)}</string>`);
  });

  it("does not use the agent label", () => {
    const plist = generateJobPlist(BASE, BASE_JOB, HOME);
    expect(plist).not.toContain(`<string>${BASE.label}</string>`);
  });
});

describe("generateJobPlist — instruction", () => {
  it("never injects DOVEPAW_INSTRUCTION — instruction is read from settings at runtime", () => {
    const job: ScheduledJob = { ...BASE_JOB, instruction: "run daily digest" };
    const plist = generateJobPlist(BASE, job, HOME);
    expect(plist).not.toContain("DOVEPAW_INSTRUCTION");
  });

  it("always injects DOVEPAW_SCHEDULED=1 regardless of instruction", () => {
    const plist = generateJobPlist(BASE, BASE_JOB, HOME);
    expect(plist).toContain("<key>DOVEPAW_SCHEDULED</key>");
    expect(plist).toContain("<string>1</string>");
  });
});

describe("generateJobPlist — onetime schedule", () => {
  const onetimeJob: ScheduledJob = {
    ...BASE_JOB,
    schedule: { type: "onetime", year: 2026, month: 6, day: 15, hour: 9, minute: 30 },
  };

  it("emits StartCalendarInterval with Month/Day/Hour/Minute", () => {
    const plist = generateJobPlist(BASE, onetimeJob, HOME);
    expect(plist).toContain("<key>StartCalendarInterval</key>");
    expect(plist).toContain("<key>Month</key>");
    expect(plist).toContain("<key>Day</key>");
    expect(plist).toContain("<key>Hour</key>");
    expect(plist).toContain("<key>Minute</key>");
  });

  it("does not emit a Year key", () => {
    const plist = generateJobPlist(BASE, onetimeJob, HOME);
    expect(plist).not.toContain("<key>Year</key>");
  });

  it("does not emit StartInterval for onetime", () => {
    const plist = generateJobPlist(BASE, onetimeJob, HOME);
    expect(plist).not.toContain("<key>StartInterval</key>");
  });

  it("includes job id as an argument in the shell command", () => {
    const plist = generateJobPlist(BASE, onetimeJob, HOME);
    expect(plist).toContain(onetimeJob.id);
  });
});

describe("generateJobPlist — non-onetime includes job id in args", () => {
  it("includes job id in the shell command for interval job", () => {
    const job: ScheduledJob = { ...BASE_JOB, schedule: { type: "interval", seconds: 300 } };
    const plist = generateJobPlist(BASE, job, HOME);
    expect(plist).toContain(job.id);
  });

  it("includes job id in the shell command for calendar job", () => {
    const job: ScheduledJob = {
      ...BASE_JOB,
      schedule: { type: "calendar", hour: 9, minute: 0 },
    };
    const plist = generateJobPlist(BASE, job, HOME);
    expect(plist).toContain(job.id);
  });
});

describe("generateJobPlist — log paths", () => {
  it("uses job id suffix in log filenames", () => {
    const plist = generateJobPlist(BASE, BASE_JOB, HOME);
    expect(plist).toContain(`out.${BASE_JOB.id}.log`);
    expect(plist).toContain(`err.${BASE_JOB.id}.log`);
  });
});

describe("generatePlist — onetime schedule (via agent.schedule)", () => {
  it("emits StartCalendarInterval with Month/Day/Hour/Minute for onetime", () => {
    const agent: AgentDef = {
      ...BASE,
      schedule: { type: "onetime", year: 2026, month: 3, day: 20, hour: 14, minute: 0 },
    };
    const plist = generatePlist(agent, HOME);
    expect(plist).toContain("<key>StartCalendarInterval</key>");
    expect(plist).toContain("<key>Month</key>");
    expect(plist).toContain("<key>Day</key>");
    expect(plist).not.toContain("<key>Year</key>");
  });
});
