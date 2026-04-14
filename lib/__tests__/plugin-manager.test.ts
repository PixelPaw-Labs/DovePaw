import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Test directories — defined via vi.hoisted so mock factories can access them ─

const {
  TMP,
  PLUGINS_DIR,
  PLUGINS_REGISTRY_FILE,
  AGENTS_ROOT,
  AGENT_SETTINGS_DIR,
  AGENT_SDK_DIR,
  AGENT_SDK_SRC,
  SKILLS_ROOT,
} = vi.hoisted(() => {
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");
  const tmp = path.join(os.tmpdir(), `plugin-manager-test-${process.pid}`);
  return {
    TMP: tmp,
    PLUGINS_DIR: path.join(tmp, "dovepaw", "plugins"),
    PLUGINS_REGISTRY_FILE: path.join(tmp, "dovepaw", "plugins.json"),
    AGENTS_ROOT: path.join(tmp, "dovepaw-repo"),
    AGENT_SETTINGS_DIR: path.join(tmp, "dovepaw", "settings.agents"),
    AGENT_SDK_DIR: path.join(tmp, "dovepaw", "sdk"),
    AGENT_SDK_SRC: path.join(tmp, "dovepaw-repo", "packages", "agent-sdk"),
    SKILLS_ROOT: path.join(tmp, "claude", "skills"),
  };
});

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../paths.js", () => ({
  AGENTS_ROOT,
  PLUGINS_DIR,
  PLUGINS_REGISTRY_FILE,
  AGENT_SETTINGS_DIR,
  AGENT_SDK_DIR,
  AGENT_SDK_SRC,
  SKILLS_ROOT,
  agentConfigDir: (name: string) => join(AGENT_SETTINGS_DIR, name),
  agentDefinitionFile: (name: string) => join(AGENT_SETTINGS_DIR, name, "agent.json"),
}));

// Mock agents-config so writeAgentFile/readAgentFile use the temp AGENT_SETTINGS_DIR,
// preventing any writes to the real ~/.dovepaw/settings.agents/.
vi.mock("../agents-config.js", async () => {
  const fsp = await import("node:fs/promises");
  const { existsSync: exists } = await import("node:fs");
  const p = await import("node:path");
  return {
    readAgentFile: async (agentName: string) => {
      const file = p.join(AGENT_SETTINGS_DIR, agentName, "agent.json");
      if (!exists(file)) return null;
      try {
        return JSON.parse(await fsp.readFile(file, "utf-8")) as object;
      } catch {
        return null;
      }
    },
    writeAgentFile: async (agentName: string, fileData: object) => {
      const dir = p.join(AGENT_SETTINGS_DIR, agentName);
      await fsp.mkdir(dir, { recursive: true });
      const dest = p.join(dir, "agent.json");
      const data = JSON.stringify(fileData, null, 2) + "\n";
      await fsp.writeFile(dest, data, "utf-8");
      await fsp.copyFile(dest, `${dest}.bak`);
    },
  };
});

vi.mock("../installer.js", () => ({
  linkAgentSdkToPlugin: vi.fn().mockResolvedValue(undefined),
  linkPluginSkills: vi.fn().mockResolvedValue(undefined),
  unlinkPluginSkills: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({ exec: vi.fn() }));
vi.mock("node:util", () => ({
  promisify: () => () => Promise.resolve({ stdout: "", stderr: "" }),
}));

const { addPlugin, removePlugin, listPlugins, syncPlugin, isGitHubSlug, repoName } =
  await import("../plugin-manager.js");
const { linkPluginSkills, unlinkPluginSkills } = await import("../installer.js");

// ─── isGitHubSlug ─────────────────────────────────────────────────────────────

describe("isGitHubSlug", () => {
  it("matches owner/repo", () => {
    expect(isGitHubSlug("delexw/DovePaw-Plugins")).toBe(true);
  });

  it("does not match full SSH URL", () => {
    expect(isGitHubSlug("git@github.com:delexw/DovePaw-Plugins")).toBe(false);
  });

  it("does not match https URL", () => {
    expect(isGitHubSlug("https://github.com/delexw/DovePaw-Plugins")).toBe(false);
  });

  it("does not match absolute local path", () => {
    expect(isGitHubSlug("/Users/yang/Plugins")).toBe(false);
  });

  it("does not match single word", () => {
    expect(isGitHubSlug("Plugins")).toBe(false);
  });
});

describe("repoName", () => {
  it("lowercases to avoid case-sensitive FS mismatches", () => {
    expect(repoName("delexw/DovePaw-Plugins")).toBe("dovepaw-plugins");
  });

  it("strips .git suffix", () => {
    expect(repoName("git@github.com:delexw/DovePaw-Plugins.git")).toBe("dovepaw-plugins");
  });

  it("handles https URL", () => {
    expect(repoName("https://github.com/delexw/DovePaw-Plugins")).toBe("dovepaw-plugins");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE_AGENT_ENTRY = {
  name: "my-agent",
  alias: "ma",
  displayName: "My Agent",
  description: "A test agent",
  doveCard: { title: "My Agent", description: "What does it do?", prompt: "What does it do?" },
  suggestions: [],
};

function makePluginDir(
  name: string,
  agents: string[],
  agentOverrides: Record<string, object> = {},
  skills: string[] = [],
): string {
  const dir = join(TMP, "local-plugins", name);
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(
    join(dir, "dovepaw-plugin.json"),
    JSON.stringify({ name, version: "1.0.0", agents, skills }),
  );
  for (const agentName of agents) {
    mkdirSync(join(dir, "agents", agentName), { recursive: true });
    writeFileSync(
      join(dir, "agents", agentName, "agent.json"),
      JSON.stringify({ ...BASE_AGENT_ENTRY, name: agentName, ...agentOverrides[agentName] }),
    );
  }
  for (const skillName of skills) {
    mkdirSync(join(dir, "skills", skillName), { recursive: true });
    writeFileSync(join(dir, "skills", skillName, "SKILL.md"), `# ${skillName}`);
  }
  return dir;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mkdirSync(join(AGENTS_ROOT, "agents", "lib"), { recursive: true });
  mkdirSync(AGENT_SETTINGS_DIR, { recursive: true });
  mkdirSync(join(TMP, "dovepaw"), { recursive: true });
});

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
  vi.clearAllMocks();
});

// ─── listPlugins ──────────────────────────────────────────────────────────────

describe("listPlugins", () => {
  it("returns [] when registry file is absent", async () => {
    const plugins = await listPlugins();
    expect(plugins).toEqual([]);
  });

  it("returns [] when registry file is corrupt", async () => {
    writeFileSync(PLUGINS_REGISTRY_FILE, "not-json");
    const plugins = await listPlugins();
    expect(plugins).toEqual([]);
  });
});

// ─── addPlugin (local path) ───────────────────────────────────────────────────

describe("addPlugin — local path", () => {
  it("registers the plugin and returns a PluginRecord", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    const record = await addPlugin(pluginDir);

    expect(record.name).toBe("test-plugin");
    expect(record.path).toBe(pluginDir);
    expect(record.gitUrl).toBeUndefined();
    expect(record.agentNames).toEqual(["my-agent"]);
    expect(record.installedAt).toBeTruthy();
  });

  it("writes agent.json to settings.agents for each agent", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    await addPlugin(pluginDir);

    const agentFile = join(AGENT_SETTINGS_DIR, "my-agent", "agent.json");
    expect(existsSync(agentFile)).toBe(true);
    const content = JSON.parse(readFileSync(agentFile, "utf-8")) as { pluginPath: string };
    expect(content.pluginPath).toBe(pluginDir);
  });

  it("writes the plugin to plugins.json registry", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    await addPlugin(pluginDir);

    expect(existsSync(PLUGINS_REGISTRY_FILE)).toBe(true);
    const registry = JSON.parse(readFileSync(PLUGINS_REGISTRY_FILE, "utf-8")) as {
      plugins: { name: string }[];
    };
    expect(registry.plugins).toHaveLength(1);
    expect(registry.plugins[0]!.name).toBe("test-plugin");
  });

  it("handles multiple agents in one plugin", async () => {
    const pluginDir = makePluginDir("multi-plugin", ["agent-a", "agent-b"]);
    const record = await addPlugin(pluginDir);

    expect(record.agentNames).toEqual(["agent-a", "agent-b"]);
    expect(existsSync(join(AGENT_SETTINGS_DIR, "agent-a", "agent.json"))).toBe(true);
    expect(existsSync(join(AGENT_SETTINGS_DIR, "agent-b", "agent.json"))).toBe(true);
  });

  it("preserves installedAt when re-adding an existing plugin", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    const first = await addPlugin(pluginDir);
    const second = await addPlugin(pluginDir);
    expect(second.installedAt).toBe(first.installedAt);
  });

  it("throws when dovepaw-plugin.json is missing", async () => {
    const dir = join(TMP, "bad-plugin");
    mkdirSync(dir, { recursive: true });
    await expect(addPlugin(dir)).rejects.toThrow("dovepaw-plugin.json");
  });

  it("throws when an agent.json is missing from the plugin", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    rmSync(join(pluginDir, "agents", "my-agent", "agent.json"));
    await expect(addPlugin(pluginDir)).rejects.toThrow("agent.json");
  });

  it("seeds envVars from plugin source on fresh install", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"], {
      "my-agent": {
        envVars: [
          { key: "PROJECTS", value: "foo,bar" },
          { key: "API_KEY", value: "test-key" },
        ],
      },
    });
    await addPlugin(pluginDir);

    const content = JSON.parse(
      readFileSync(join(AGENT_SETTINGS_DIR, "my-agent", "agent.json"), "utf-8"),
    ) as { envVars: { key: string; value: string; isSecret: boolean }[] };
    expect(content.envVars).toHaveLength(2);
    expect(content.envVars.find((v) => v.key === "PROJECTS")?.value).toBe("foo,bar");
    expect(content.envVars.find((v) => v.key === "API_KEY")?.value).toBe("test-key");
    expect(content.envVars.every((v) => !v.isSecret)).toBe(true);
  });

  it("starts with empty envVars when plugin source has none", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    await addPlugin(pluginDir);

    const content = JSON.parse(
      readFileSync(join(AGENT_SETTINGS_DIR, "my-agent", "agent.json"), "utf-8"),
    ) as { envVars: unknown[] };
    expect(content.envVars).toEqual([]);
  });

  it("calls linkPluginSkills with plugin dir and skill names", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"], {}, ["create-pr", "git-commit"]);
    const record = await addPlugin(pluginDir);

    expect(record.skillNames).toEqual(["create-pr", "git-commit"]);
    expect(linkPluginSkills).toHaveBeenCalledWith(pluginDir, ["create-pr", "git-commit"]);
  });

  it("stores empty skillNames when plugin has no skills", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    const record = await addPlugin(pluginDir);

    expect(record.skillNames).toEqual([]);
    expect(linkPluginSkills).toHaveBeenCalledWith(pluginDir, []);
  });
});

// ─── removePlugin ─────────────────────────────────────────────────────────────

describe("removePlugin", () => {
  it("deletes agent settings dirs and removes entry from registry", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"]);
    await addPlugin(pluginDir);
    await removePlugin("test-plugin");

    expect(existsSync(join(AGENT_SETTINGS_DIR, "my-agent"))).toBe(false);
    const registry = JSON.parse(readFileSync(PLUGINS_REGISTRY_FILE, "utf-8")) as {
      plugins: unknown[];
    };
    expect(registry.plugins).toHaveLength(0);
  });

  it("throws when plugin is not installed", async () => {
    await expect(removePlugin("no-such-plugin")).rejects.toThrow("not installed");
  });

  it("calls unlinkPluginSkills with the plugin's skill names", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"], {}, ["create-pr"]);
    await addPlugin(pluginDir);
    vi.clearAllMocks();

    await removePlugin("test-plugin");
    expect(unlinkPluginSkills).toHaveBeenCalledWith(["create-pr"]);
  });
});

// ─── syncPlugin ───────────────────────────────────────────────────────────────

describe("syncPlugin", () => {
  it("adds newly listed agents from the manifest", async () => {
    const pluginDir = makePluginDir("test-plugin", ["agent-a"]);
    await addPlugin(pluginDir);

    mkdirSync(join(pluginDir, "agents", "agent-b"), { recursive: true });
    writeFileSync(
      join(pluginDir, "agents", "agent-b", "agent.json"),
      JSON.stringify({ ...BASE_AGENT_ENTRY, name: "agent-b" }),
    );
    writeFileSync(
      join(pluginDir, "dovepaw-plugin.json"),
      JSON.stringify({ name: "test-plugin", version: "1.1.0", agents: ["agent-a", "agent-b"] }),
    );

    const updated = await syncPlugin("test-plugin");
    expect(updated.agentNames).toEqual(["agent-a", "agent-b"]);
    expect(existsSync(join(AGENT_SETTINGS_DIR, "agent-b", "agent.json"))).toBe(true);
  });

  it("removes settings for agents no longer in the manifest", async () => {
    const pluginDir = makePluginDir("test-plugin", ["agent-a", "agent-b"]);
    await addPlugin(pluginDir);

    writeFileSync(
      join(pluginDir, "dovepaw-plugin.json"),
      JSON.stringify({ name: "test-plugin", version: "1.1.0", agents: ["agent-a"] }),
    );

    await syncPlugin("test-plugin");
    expect(existsSync(join(AGENT_SETTINGS_DIR, "agent-b"))).toBe(false);
    expect(existsSync(join(AGENT_SETTINGS_DIR, "agent-a", "agent.json"))).toBe(true);
  });

  it("throws when plugin is not installed", async () => {
    await expect(syncPlugin("no-such-plugin")).rejects.toThrow("not installed");
  });

  it("links newly added skills on sync", async () => {
    const pluginDir = makePluginDir("test-plugin", ["agent-a"], {}, ["create-pr"]);
    await addPlugin(pluginDir);
    vi.clearAllMocks();

    mkdirSync(join(pluginDir, "skills", "git-commit"), { recursive: true });
    writeFileSync(join(pluginDir, "skills", "git-commit", "SKILL.md"), "# git-commit");
    writeFileSync(
      join(pluginDir, "dovepaw-plugin.json"),
      JSON.stringify({
        name: "test-plugin",
        version: "1.1.0",
        agents: ["agent-a"],
        skills: ["create-pr", "git-commit"],
      }),
    );

    const updated = await syncPlugin("test-plugin");
    expect(updated.skillNames).toEqual(["create-pr", "git-commit"]);
    expect(linkPluginSkills).toHaveBeenCalledWith(pluginDir, ["git-commit"]);
  });

  it("unlinks removed skills on sync", async () => {
    const pluginDir = makePluginDir("test-plugin", ["agent-a"], {}, ["create-pr", "git-commit"]);
    await addPlugin(pluginDir);
    vi.clearAllMocks();

    writeFileSync(
      join(pluginDir, "dovepaw-plugin.json"),
      JSON.stringify({
        name: "test-plugin",
        version: "1.1.0",
        agents: ["agent-a"],
        skills: ["create-pr"],
      }),
    );

    const updated = await syncPlugin("test-plugin");
    expect(updated.skillNames).toEqual(["create-pr"]);
    expect(unlinkPluginSkills).toHaveBeenCalledWith(["git-commit"]);
  });

  it("preserves existing envVars on sync — does not overwrite with plugin source defaults", async () => {
    const pluginDir = makePluginDir("test-plugin", ["my-agent"], {
      "my-agent": { envVars: [{ key: "PROJECTS", value: "seed-value" }] },
    });
    await addPlugin(pluginDir);

    // Simulate user having changed the value after install
    const agentFile = join(AGENT_SETTINGS_DIR, "my-agent", "agent.json");
    const existing = JSON.parse(readFileSync(agentFile, "utf-8")) as {
      envVars: { key: string; value: string }[];
    };
    existing.envVars[0]!.value = "user-configured-value";
    writeFileSync(agentFile, JSON.stringify(existing, null, 2));

    // Sync (simulates plugin update)
    await syncPlugin("test-plugin");

    const updated = JSON.parse(readFileSync(agentFile, "utf-8")) as {
      envVars: { key: string; value: string }[];
    };
    expect(updated.envVars.find((v) => v.key === "PROJECTS")?.value).toBe("user-configured-value");
  });
});
