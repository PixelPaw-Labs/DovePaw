import { describe, expect, it, vi, afterEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const spawnMock = vi.fn(() => ({ pid: 42, unref: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

const { createServersProcess, killServers } = await import("../server-manager.js");

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.clearAllMocks();
});

describe("createServersProcess", () => {
  it("spawns 'npm run chatbot:servers'", () => {
    createServersProcess();
    expect(spawnMock).toHaveBeenCalledWith("npm", ["run", "chatbot:servers"], expect.any(Object));
  });

  it("uses cwd that contains DovePaw (not its parent)", () => {
    createServersProcess();
    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      expect.any(Array),
      expect.objectContaining({ cwd: expect.stringContaining("DovePaw") }),
    );
    expect(spawnMock).not.toHaveBeenCalledWith(
      "npm",
      expect.any(Array),
      expect.objectContaining({ cwd: expect.stringMatching(/Envato\/others$/) }),
    );
  });

  it("forwards DOVEPAW_PORT env var", () => {
    createServersProcess(7474);
    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      expect.any(Array),
      expect.objectContaining({ env: expect.objectContaining({ DOVEPAW_PORT: "7474" }) }),
    );
  });

  it("spawns detached with the requested stdio", () => {
    createServersProcess(7473, "pipe");
    expect(spawnMock).toHaveBeenCalledWith(
      "npm",
      expect.any(Array),
      expect.objectContaining({ detached: true, stdio: "pipe" }),
    );
  });
});

describe("killServers", () => {
  it("no-ops when PID file is absent", () => {
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    killServers();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});
