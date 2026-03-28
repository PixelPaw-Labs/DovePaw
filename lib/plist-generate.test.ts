import { describe, expect, it } from "vitest";
import { generatePlist, plistLabel } from "./plist-generate.js";
import type { AgentDef } from "./agents.js";
import { Brain } from "lucide-react";

const BASE: AgentDef = {
  name: "test-agent",
  entryPath: "src/test-agent/index.ts",
  displayName: "Test Agent",
  label: "Claude Code Agent - Test Agent",
  manifestKey: "test_agent",
  toolName: "run_test_agent",
  description: "A test agent",
  requiredEnvVars: [],
  scheduleDisplay: "daily 09:00",
  schedule: { type: "calendar", hour: 9, minute: 0 },
  icon: Brain,
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

  it("sources the env bootstrap script if present", () => {
    const plist = generatePlist(BASE, HOME);
    expect(plist).toContain("test-agent.env.sh");
    expect(plist).toContain("source");
  });

  it("guards env script sourcing with a file existence check", () => {
    const plist = generatePlist(BASE, HOME);
    // && is XML-escaped to &amp;&amp; inside the plist string value
    expect(plist).toMatch(/\[ -f '.*test-agent\.env\.sh' \] &amp;&amp; source/);
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
});
