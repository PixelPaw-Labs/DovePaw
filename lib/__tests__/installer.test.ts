import { describe, it, expect, vi, beforeEach } from "vitest";
import { access, copyFile, chmod } from "node:fs/promises";
import { exec, type ExecException } from "node:child_process";

// Mock node modules before importing the module under test
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined), // used by deployTriggerScript internally
  access: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
  symlink: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execSync: vi.fn().mockReturnValue(Buffer.from("1000")),
}));

vi.mock("node:util", () => ({
  promisify: vi.fn((fn) => {
    // Return a promisified version that calls the mock
    return (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
  }),
}));

const { deployTriggerScript } = await import("../installer.js");

describe("deployTriggerScript", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies the trigger script directly when dist file exists", async () => {
    vi.mocked(access).mockResolvedValue(undefined);

    await deployTriggerScript();

    expect(exec).not.toHaveBeenCalled();
    expect(copyFile).toHaveBeenCalledOnce();
    expect(chmod).toHaveBeenCalledOnce();
  });

  it("runs npm run build before copying when dist file is missing", async () => {
    vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
      (cb as unknown as (err: ExecException | null, stdout: string, stderr: string) => void)(
        null,
        "",
        "",
      );
      return {} as ReturnType<typeof exec>;
    });

    await deployTriggerScript();

    expect(exec).toHaveBeenCalledWith(
      "npm run build",
      expect.objectContaining({ cwd: expect.stringContaining("DovePaw") }),
      expect.any(Function),
    );
    expect(copyFile).toHaveBeenCalledOnce();
    expect(chmod).toHaveBeenCalledOnce();
  });
});
