import { describe, expect, it, vi, beforeEach } from "vitest";

// Partial mock: only the keychain read is faked. The service-name helpers stay
// real so these tests assert the same strings the settings routes write under.
vi.mock("@/lib/keyring", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/keyring")>()),
  getSecret: vi.fn(),
}));

import { getSecret, agentKeychainService, groupKeychainService } from "@/lib/keyring";
import { resolveEnvVarList, resolveSettingsEnv } from "@/lib/env-resolver";
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
    const env = resolveSettingsEnv(
      makeSettings(),
      [{ id: "1", key: "ZENDESK_SLACK_CHANNELS", value: "support,billing", isSecret: false }],
      "zendesk-triager",
    );
    expect(env["ZENDESK_SLACK_CHANNELS"]).toBe("support,billing");
  });

  it("per-agent var overrides global var with same key", () => {
    const settings = makeSettings({
      envVars: [{ id: "1", key: "SLACK_WORKSPACE", value: "global.slack.com", isSecret: false }],
    });
    const env = resolveSettingsEnv(
      settings,
      [{ id: "2", key: "SLACK_WORKSPACE", value: "agent.slack.com", isSecret: false }],
      "zendesk-triager",
    );
    expect(env["SLACK_WORKSPACE"]).toBe("agent.slack.com");
  });

  it("per-agent secret var is resolved from keychain", () => {
    vi.mocked(getSecret).mockReturnValue("agent-secret");
    const env = resolveSettingsEnv(
      makeSettings(),
      [{ id: "1", key: "AGENT_TOKEN", value: "", isSecret: true }],
      "memory-dream",
    );
    expect(env["AGENT_TOKEN"]).toBe("agent-secret");
  });

  it("reads a per-agent secret from the agent's keychain service, not the global one", () => {
    vi.mocked(getSecret).mockReturnValue("agent-secret");
    resolveSettingsEnv(
      makeSettings(),
      [{ id: "1", key: "SESSION_API_TOKEN", value: "", isSecret: true }],
      "memory-dream",
    );
    // This is the service the settings route writes under — the two must agree.
    expect(getSecret).toHaveBeenCalledWith(
      agentKeychainService("memory-dream"),
      "SESSION_API_TOKEN",
    );
  });

  it("keeps global secrets on the global service even when an agent name is given", () => {
    vi.mocked(getSecret).mockReturnValue("global-secret");
    const settings = makeSettings({
      envVars: [{ id: "1", key: "GLOBAL_TOKEN", value: "", isSecret: true }],
    });
    resolveSettingsEnv(settings, [], "memory-dream");
    expect(getSecret).toHaveBeenCalledWith("dovepaw", "GLOBAL_TOKEN");
  });

  it("an explicit keychainService still wins for a per-agent var", () => {
    vi.mocked(getSecret).mockReturnValue("linked-secret");
    resolveSettingsEnv(
      makeSettings(),
      [
        {
          id: "1",
          key: "JIRA_API_TOKEN",
          value: "",
          isSecret: true,
          keychainService: "jira-cli",
          keychainAccount: "user@example.com",
        },
      ],
      "memory-dream",
    );
    expect(getSecret).toHaveBeenCalledWith("jira-cli", "user@example.com");
  });

  it("defaults to empty array when agentEnvVars omitted", () => {
    const env = resolveSettingsEnv(makeSettings());
    expect(env).toEqual({});
  });
});

// ─── Group env vars ───────────────────────────────────────────────────────────

describe("group env vars", () => {
  it("reads a group secret from the group's keychain service", () => {
    vi.mocked(getSecret).mockReturnValue("group-secret");
    const env = resolveEnvVarList(
      [{ id: "1", key: "GROUP_TOKEN", value: "", isSecret: true }],
      groupKeychainService("squad"),
    );
    expect(getSecret).toHaveBeenCalledWith(groupKeychainService("squad"), "GROUP_TOKEN");
    expect(env["GROUP_TOKEN"]).toBe("group-secret");
  });

  it("falls back to the global service when no scope is given", () => {
    vi.mocked(getSecret).mockReturnValue("secret");
    resolveEnvVarList([{ id: "1", key: "LOOSE_TOKEN", value: "", isSecret: true }]);
    expect(getSecret).toHaveBeenCalledWith("dovepaw", "LOOSE_TOKEN");
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
