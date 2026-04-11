import { join } from "node:path";
import {
  AGENTS_ROOT,
  DOVEPAW_DIR,
  DOVEPAW_AGENT_STATE,
  agentPersistentStateDir,
  DOVEPAW_AGENT_LOGS,
  agentPersistentLogDir,
  SCHEDULER_ROOT,
} from "./paths.js";

describe("paths", () => {
  it("AGENTS_ROOT contains DovePaw and is not the parent directory", () => {
    // Regression: the webpack fallback was resolve(cwd, '..') which gave
    // the PARENT of DovePaw. The correct fallback is process.cwd() = DovePaw.
    expect(AGENTS_ROOT).toMatch(/DovePaw/);
    expect(AGENTS_ROOT).not.toMatch(/Envato\/others$/);
  });

  it("DOVEPAW_AGENT_STATE is under ~/.dovepaw/agents/state", () => {
    expect(DOVEPAW_AGENT_STATE).toBe(join(process.env.HOME!, ".dovepaw/agents/state"));
  });

  it("agentPersistentStateDir returns dotted subdir under DOVEPAW_AGENT_STATE", () => {
    expect(agentPersistentStateDir("get-shit-done")).toBe(
      join(DOVEPAW_AGENT_STATE, ".get-shit-done"),
    );
  });

  it("agentPersistentStateDir uses dot-prefixed folder for agent name", () => {
    expect(agentPersistentStateDir("my-agent")).toMatch(/\/\.my-agent$/);
  });

  it("DOVEPAW_AGENT_LOGS is under ~/.dovepaw/agents/logs", () => {
    expect(DOVEPAW_AGENT_LOGS).toBe(join(process.env.HOME!, ".dovepaw/agents/logs"));
  });

  it("agentPersistentLogDir returns dotted subdir under DOVEPAW_AGENT_LOGS", () => {
    expect(agentPersistentLogDir("get-shit-done")).toBe(join(DOVEPAW_AGENT_LOGS, ".get-shit-done"));
  });

  it("agentPersistentLogDir uses dot-prefixed folder for agent name", () => {
    expect(agentPersistentLogDir("my-agent")).toMatch(/\/\.my-agent$/);
  });

  it("SCHEDULER_ROOT is under ~/.dovepaw/cron", () => {
    expect(SCHEDULER_ROOT).toBe(join(DOVEPAW_DIR, "cron"));
  });
});
