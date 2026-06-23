import { describe, expect, it, vi, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const spawnMock = vi.fn(() => ({ pid: 42, unref: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const { createServersProcess, killServers, killAllServers, writeServersPidFile } =
  await import("../server-manager.js");

const existsSyncMock = vi.mocked(existsSync);
const readFileSyncMock = vi.mocked(readFileSync);
const rmSyncMock = vi.mocked(rmSync);
const writeFileSyncMock = vi.mocked(writeFileSync);

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.clearAllMocks();
  existsSyncMock.mockReturnValue(false);
  readFileSyncMock.mockReturnValue("");
  vi.useRealTimers();
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

  it("kills the PID-file process group when present", () => {
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("123");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    killServers();

    expect(rmSyncMock).toHaveBeenCalledWith(expect.stringContaining(".a2a-servers.pid"), {
      force: true,
    });
    expect(killSpy).toHaveBeenCalledWith(-123, "SIGTERM");
    expect(rmSyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      killSpy.mock.invocationCallOrder[0],
    );
    killSpy.mockRestore();
  });
});

describe("killAllServers", () => {
  it("kills the tracked process group gracefully before escalating", async () => {
    vi.useFakeTimers();
    existsSyncMock.mockReturnValue(true);
    readFileSyncMock.mockReturnValue("123");
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const promise = killAllServers();
    await vi.advanceTimersByTimeAsync(1_000);
    await promise;

    expect(rmSyncMock).toHaveBeenCalledWith(expect.stringContaining(".a2a-servers.pid"), {
      force: true,
    });
    expect(killSpy).toHaveBeenCalledWith(-123, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(-123, "SIGKILL");
    killSpy.mockRestore();
  });
});

describe("writeServersPidFile", () => {
  it("writes the managed process-group root PID", () => {
    writeServersPidFile(123);

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining(".a2a-servers.pid"),
      "123",
      "utf-8",
    );
  });
});
