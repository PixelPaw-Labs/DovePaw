import { describe, expect, it } from "vitest";
import { generatePlist, plistLabel } from "./plist-generate.js";
import type { AgentDef } from "./agents.js";
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
    expect(plistLabel(BASE)).toBe("com.claude.scheduler.test-agent");
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

  it("runs a2a-trigger.mjs with the agent manifestKey", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain("a2a-trigger.mjs");
    expect(plist).toContain(BASE.manifestKey);
  });
});

describe("generatePlist — structure", () => {
  it("sets ProcessType to Interactive", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain("<string>Interactive</string>");
  });

  it("uses the agent label as the plist Label key", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain(`<string>${BASE.label}</string>`);
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
