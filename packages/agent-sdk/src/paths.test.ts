import { join } from "node:path";
import {
  agentPersistentLogDir,
  agentPersistentStateDir,
  agentConfigDir,
  claudeWorktreePath,
} from "./paths.js";

const HOME = process.env.HOME!;
const DOVEPAW = join(HOME, ".dovepaw");

describe("agentPersistentLogDir", () => {
  it("returns the correct log directory path", () => {
    expect(agentPersistentLogDir("my-agent")).toBe(join(DOVEPAW, "agents/logs", ".my-agent"));
  });
});

describe("agentPersistentStateDir", () => {
  it("returns the correct state directory path", () => {
    expect(agentPersistentStateDir("my-agent")).toBe(join(DOVEPAW, "agents/state", ".my-agent"));
  });
});

describe("agentConfigDir", () => {
  it("returns the correct config directory path", () => {
    expect(agentConfigDir("my-agent")).toBe(join(DOVEPAW, "settings.agents", "my-agent"));
  });
});

describe("claudeWorktreePath", () => {
  it("returns the correct worktree path", () => {
    expect(claudeWorktreePath("/repos/my-project", "feature-branch")).toBe(
      join("/repos/my-project", ".claude", "worktrees", "feature-branch"),
    );
  });
});
