import { join } from "node:path";
import { DOVEPAW_AGENT_STATE, agentPersistentStateDir } from "./paths.js";

describe("paths", () => {
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
});
