import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/keyring", () => ({
  DOVEPAW_SERVICE: "dovepaw",
  getSecret: vi.fn(),
}));

import { getSecret } from "@/lib/keyring";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import type { GlobalSettings } from "@@/lib/settings-schemas";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const REPO_A = { id: "r1", name: "repo-alpha", githubRepo: "org/repo-alpha" };
const REPO_B = { id: "r2", name: "repo-beta", githubRepo: "org/repo-beta" };
const REPO_C = { id: "r3", name: "sso-server", githubRepo: "org/sso-server" };

function makeSettings(overrides: Partial<GlobalSettings> = {}): GlobalSettings {
  return {
    version: 1,
    repositories: [REPO_A, REPO_B, REPO_C],
    envVars: [],
    ...overrides,
  };
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
    const env = resolveSettingsEnv(undefined, settings, []);
    expect(env["JIRA_SERVER"]).toBe("https://example.atlassian.net");
  });

  it("excludes plain var with empty value", () => {
    const settings = makeSettings({
      envVars: [{ id: "1", key: "EMPTY_VAR", value: "", isSecret: false }],
    });
    const env = resolveSettingsEnv(undefined, settings, []);
    expect("EMPTY_VAR" in env).toBe(false);
  });

  it("includes multiple plain vars", () => {
    const settings = makeSettings({
      envVars: [
        { id: "1", key: "FOO", value: "foo", isSecret: false },
        { id: "2", key: "BAR", value: "bar", isSecret: false },
      ],
    });
    const env = resolveSettingsEnv(undefined, settings, []);
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
    const env = resolveSettingsEnv(undefined, settings, []);
    expect(getSecret).toHaveBeenCalledWith("jira-cli", "user@example.com");
    expect(env["JIRA_API_TOKEN"]).toBe("super-secret");
  });

  it("falls back to dovepaw service and key as account when no keychainService", () => {
    vi.mocked(getSecret).mockReturnValue("my-secret");
    const settings = makeSettings({
      envVars: [{ id: "1", key: "MY_SECRET", value: "", isSecret: true }],
    });
    resolveSettingsEnv(undefined, settings, []);
    expect(getSecret).toHaveBeenCalledWith("dovepaw", "MY_SECRET");
  });

  it("excludes secret when keychain returns null", () => {
    vi.mocked(getSecret).mockReturnValue(null);
    const settings = makeSettings({
      envVars: [{ id: "1", key: "MISSING_SECRET", value: "", isSecret: true }],
    });
    const env = resolveSettingsEnv(undefined, settings, []);
    expect("MISSING_SECRET" in env).toBe(false);
  });

  it("excludes secret when keychain returns empty string", () => {
    vi.mocked(getSecret).mockReturnValue("");
    const settings = makeSettings({
      envVars: [{ id: "1", key: "BLANK_SECRET", value: "", isSecret: true }],
    });
    const env = resolveSettingsEnv(undefined, settings, []);
    expect("BLANK_SECRET" in env).toBe(false);
  });
});

// ─── Agent repos resolution ───────────────────────────────────────────────────

describe("agent repos", () => {
  it("sets reposEnvVar to comma-separated githubRepo slugs", () => {
    const env = resolveSettingsEnv("REPO_LIST", makeSettings(), ["r1", "r2"]);
    expect(env["REPO_LIST"]).toBe("org/repo-alpha,org/repo-beta");
  });

  it("resolves a single repo", () => {
    const env = resolveSettingsEnv("REPO_LIST", makeSettings(), ["r3"]);
    expect(env["REPO_LIST"]).toBe("org/sso-server");
  });

  it("skips unknown repo IDs", () => {
    const env = resolveSettingsEnv("REPO_LIST", makeSettings(), ["r1", "unknown-id"]);
    expect(env["REPO_LIST"]).toBe("org/repo-alpha");
  });

  it("omits reposEnvVar when agentRepos list is empty", () => {
    const env = resolveSettingsEnv("REPO_LIST", makeSettings(), []);
    expect("REPO_LIST" in env).toBe(false);
  });

  it("does not set any repos key when reposEnvVar is undefined", () => {
    const env = resolveSettingsEnv(undefined, makeSettings(), ["r1"]);
    expect("REPO_LIST" in env).toBe(false);
  });

  it("resolves all three repos in order", () => {
    const env = resolveSettingsEnv("REPO_LIST", makeSettings(), ["r3", "r1", "r2"]);
    expect(env["REPO_LIST"]).toBe("org/sso-server,org/repo-alpha,org/repo-beta");
  });
});

// ─── Per-agent env var overrides ──────────────────────────────────────────────

describe("per-agent env vars", () => {
  it("includes a plain per-agent var", () => {
    const env = resolveSettingsEnv(
      undefined,
      makeSettings(),
      [],
      [{ id: "1", key: "ZENDESK_SLACK_CHANNELS", value: "support,billing", isSecret: false }],
    );
    expect(env["ZENDESK_SLACK_CHANNELS"]).toBe("support,billing");
  });

  it("per-agent var overrides global var with same key", () => {
    const settings = makeSettings({
      envVars: [{ id: "1", key: "SLACK_WORKSPACE", value: "global.slack.com", isSecret: false }],
    });
    const env = resolveSettingsEnv(
      undefined,
      settings,
      [],
      [{ id: "2", key: "SLACK_WORKSPACE", value: "agent.slack.com", isSecret: false }],
    );
    expect(env["SLACK_WORKSPACE"]).toBe("agent.slack.com");
  });

  it("per-agent secret var is resolved from keychain", () => {
    vi.mocked(getSecret).mockReturnValue("agent-secret");
    const env = resolveSettingsEnv(
      undefined,
      makeSettings(),
      [],
      [{ id: "1", key: "AGENT_TOKEN", value: "", isSecret: true }],
    );
    expect(env["AGENT_TOKEN"]).toBe("agent-secret");
  });

  it("defaults to empty array when agentEnvVars omitted", () => {
    const env = resolveSettingsEnv(undefined, makeSettings(), []);
    expect(env).toEqual({});
  });
});

// ─── Combined plain + secret + repos ─────────────────────────────────────────

describe("combined resolution", () => {
  it("returns all three categories merged", () => {
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
    const env = resolveSettingsEnv("REPO_LIST", settings, ["r1"]);
    expect(env).toMatchObject({
      JIRA_SERVER: "https://example.atlassian.net",
      JIRA_API_TOKEN: "tok123",
      REPO_LIST: "org/repo-alpha",
    });
  });

  it("returns empty object when settings has no vars and no repos", () => {
    const env = resolveSettingsEnv(undefined, makeSettings(), []);
    expect(env).toEqual({});
  });
});
