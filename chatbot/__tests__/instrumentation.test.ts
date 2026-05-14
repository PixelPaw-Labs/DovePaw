/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);
vi.mock("node:fs/promises", () => ({
  default: { mkdir: mockMkdir, writeFile: mockWriteFile, rm: mockRm },
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
  rm: mockRm,
}));

vi.mock("@@/lib/paths", () => ({
  OPENVIKING_PORT_FILE: "/mock/.openviking-port.json",
  OPENVIKING_SIDECAR_PID_FILE: "/mock/.openviking-pid",
}));

vi.mock("@/lib/memory", () => ({ setMemoryProvider: vi.fn() }));

vi.mock("@/lib/memory/openviking", () => ({
  OpenVikingMemoryProvider: { boot: vi.fn() },
}));

vi.mock("@/lib/process-orphan-cleanup", () => ({
  killStaleProcess: vi.fn().mockResolvedValue(undefined),
  onProcessExit: vi.fn(),
  removePidFile: vi.fn(),
  writePidFile: vi.fn(),
}));

vi.mock("@/lib/get-available-port", () => ({
  getAvailablePort: vi.fn().mockResolvedValue(12345),
}));

vi.mock("consola", () => ({
  consola: { warn: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

describe("instrumentation register()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXT_RUNTIME = "nodejs";
  });

  it("removes the stale port file when sidecar boot fails", async () => {
    const { OpenVikingMemoryProvider } = await import("@/lib/memory/openviking");
    vi.mocked(OpenVikingMemoryProvider.boot as any).mockRejectedValue(new Error("nope"));

    const { register } = await import("../instrumentation");
    await register();

    expect(mockRm).toHaveBeenCalledWith("/mock/.openviking-port.json", { force: true });
  });

  it("logs the full sidecar URL (not just the port) on successful boot", async () => {
    const { OpenVikingMemoryProvider } = await import("@/lib/memory/openviking");
    vi.mocked(OpenVikingMemoryProvider.boot as any).mockResolvedValue({
      proc: { pid: 4242 },
      shutdown: vi.fn(),
    });
    const { consola } = await import("consola");

    const { register } = await import("../instrumentation");
    await register();

    expect(consola.success).toHaveBeenCalledWith(expect.stringContaining("http://localhost:12345"));
  });

  it("does not remove the PID file in the exit handler", async () => {
    const { OpenVikingMemoryProvider } = await import("@/lib/memory/openviking");
    vi.mocked(OpenVikingMemoryProvider.boot as any).mockResolvedValue({
      proc: { pid: 4242 },
      shutdown: vi.fn().mockResolvedValue(undefined),
    });
    const { onProcessExit, removePidFile } = await import("@/lib/process-orphan-cleanup");

    const { register } = await import("../instrumentation");
    await register();

    const exitHandler = vi.mocked(onProcessExit).mock.calls[0][0] as () => void;
    exitHandler();

    expect(removePidFile).not.toHaveBeenCalled();
  });
});
