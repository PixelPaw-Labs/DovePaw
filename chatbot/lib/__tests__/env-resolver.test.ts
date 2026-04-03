import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/keyring", () => ({
  DOVEPAW_SERVICE: "dovepaw",
  getSecret: vi.fn(),
}));

import { getSecret } from "@/lib/keyring";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import type { GlobalSettings } from "@@/lib/settings-schemas";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return { version: 1, repositories: [], envVars: [], ...overrides };
}

beforeEach(() => vi.clearAllMocks());

// ─── Plain env vars ────────────────────────────────────────────────────────────

describe("plain env vars", () => {
  it("includes plain var with non-empty value", () => {
    const settings = makeSettings({
      envVars: [
        { id: "1", key: "JIRA_SERVER", value: "https://example.atlassian.net", isSecret: false },
      ],
    });
    const env = resolveSettingsEnv(settings);
    expect(env["JIRA_SERVER"]).toBe("https://example.atlassian.net");
  });

  it("excludes plain var with empty value", () => {
    const settings = makeSettings({
      envVars: [{ id: "1", key: "EMPTY_VAR", value: "", isSecret: false }],
    });
    const env = resolveSettingsEnv(settings);
    expect("EMPTY_VAR" in env).toBe(false);
  });

  it("includes multiple plain vars", () => {
    const settings = makeSettings({
      envVars: [
        { id: "1", key: "FOO", value: "foo", isSecret: false },
        { id: "2", key: "BAR", value: "bar", isSecret: false },
      ],
    });
    const env = resolveSettingsEnv(settings);
    expect(env).toMatchObject({ FOO: "foo", BAR: "bar" });
  });
});

// ─── Secret env vars ──────────────────────────────────────────────────────────

describe("secret env vars", () => {
  it("reads secret from keychain using keychainService and keychainAccount", () => {
    vi.mocked(getSecret).mockReturnValue("super-secret");
    const settings = makeSettings({
      envVars: [
        {
          id: "1",
          key: "JIRA_API_TOKEN",
          value: "",
          isSecret: true,
          keychainService: "jira-cli",
          keychainAccount: "user@example.com",
        },
      ],
    });
    const env = resolveSettingsEnv(settings);
    expect(getSecret).toHaveBeenCalledWith("jira-cli", "user@example.com");
    expect(env["JIRA_API_TOKEN"]).toBe("super-secret");
  });

  it("falls back to dovepaw service and key as account when no keychainService", () => {
    vi.mocked(getSecret).mockReturnValue("my-secret");
    const settings = makeSettings({
      envVars: [{ id: "1", key: "MY_SECRET", value: "", isSecret: true }],
    });
    resolveSettingsEnv(settings);
    expect(getSecret).toHaveBeenCalledWith("dovepaw", "MY_SECRET");
  });

  it("excludes secret when keychain returns null", () => {
    vi.mocked(getSecret).mockReturnValue(null);
    const settings = makeSettings({
      envVars: [{ id: "1", key: "MISSING_SECRET", value: "", isSecret: true }],
    });
    const env = resolveSettingsEnv(settings);
    expect("MISSING_SECRET" in env).toBe(false);
  });

  it("excludes secret when keychain returns empty string", () => {
    vi.mocked(getSecret).mockReturnValue("");
    const settings = makeSettings({
      envVars: [{ id: "1", key: "BLANK_SECRET", value: "", isSecret: true }],
    });
    const env = resolveSettingsEnv(settings);
    expect("BLANK_SECRET" in env).toBe(false);
  });
});

// ─── Per-agent env var overrides ──────────────────────────────────────────────

describe("per-agent env vars", () => {
  it("includes a plain per-agent var", () => {
    const env = resolveSettingsEnv(makeSettings(), [
      { id: "1", key: "ZENDESK_SLACK_CHANNELS", value: "support,billing", isSecret: false },
    ]);
    expect(env["ZENDESK_SLACK_CHANNELS"]).toBe("support,billing");
  });

  it("per-agent var overrides global var with same key", () => {
    const settings = makeSettings({
      envVars: [{ id: "1", key: "SLACK_WORKSPACE", value: "global.slack.com", isSecret: false }],
    });
    const env = resolveSettingsEnv(settings, [
      { id: "2", key: "SLACK_WORKSPACE", value: "agent.slack.com", isSecret: false },
    ]);
    expect(env["SLACK_WORKSPACE"]).toBe("agent.slack.com");
  });

  it("per-agent secret var is resolved from keychain", () => {
    vi.mocked(getSecret).mockReturnValue("agent-secret");
    const env = resolveSettingsEnv(makeSettings(), [
      { id: "1", key: "AGENT_TOKEN", value: "", isSecret: true },
    ]);
    expect(env["AGENT_TOKEN"]).toBe("agent-secret");
  });

  it("defaults to empty array when agentEnvVars omitted", () => {
    const env = resolveSettingsEnv(makeSettings());
    expect(env).toEqual({});
  });
});

// ─── Combined ─────────────────────────────────────────────────────────────────

describe("combined resolution", () => {
  it("merges global and per-agent vars", () => {
    vi.mocked(getSecret).mockImplementation((svc) => (svc === "jira-cli" ? "tok123" : null));
    const settings = makeSettings({
      envVars: [
        { id: "1", key: "JIRA_SERVER", value: "https://example.atlassian.net", isSecret: false },
        {
          id: "2",
          key: "JIRA_API_TOKEN",
          value: "",
          isSecret: true,
          keychainService: "jira-cli",
          keychainAccount: "me",
        },
      ],
    });
    const env = resolveSettingsEnv(settings);
    expect(env).toMatchObject({
      JIRA_SERVER: "https://example.atlassian.net",
      JIRA_API_TOKEN: "tok123",
    });
  });

  it("returns empty object when settings has no vars", () => {
    const env = resolveSettingsEnv(makeSettings());
    expect(env).toEqual({});
  });
});
