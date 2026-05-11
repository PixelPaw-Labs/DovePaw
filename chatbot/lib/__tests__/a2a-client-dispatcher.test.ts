import { describe, it, expect, vi } from "vitest";

const AgentCtor = vi.fn();
const setGlobalDispatcher = vi.fn();

vi.mock("undici", () => ({
  Agent: AgentCtor,
  setGlobalDispatcher,
}));

vi.mock("@a2a-js/sdk/client", () => ({
  ClientFactory: vi.fn(),
}));

describe("lib/a2a-client undici dispatcher install", () => {
  it("installs a global undici Agent with body+headers timeouts disabled on import", async () => {
    await import("@@/lib/a2a-client");

    expect(AgentCtor).toHaveBeenCalledTimes(1);
    expect(AgentCtor).toHaveBeenCalledWith({ bodyTimeout: 0, headersTimeout: 0 });
    expect(setGlobalDispatcher).toHaveBeenCalledTimes(1);
  });
});
