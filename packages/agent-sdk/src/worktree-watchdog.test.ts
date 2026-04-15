import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorktreeWatchdog } from "./worktree-watchdog.js";

const TMP_DIR = join(tmpdir(), `watchdog-test-${process.pid}`);

/** Keep the event loop alive during a test (watchdog uses unref'd intervals) */
function keepAlive(ms: number): { clear: () => void } {
  const t = setTimeout(() => {}, ms);
  return { clear: () => clearTimeout(t) };
}

describe("WorktreeWatchdog", () => {
  it("resolves hung when path never appears", async () => {
    const alive = keepAlive(500);
    const wd = new WorktreeWatchdog({ timeoutMs: 100, pollMs: 20 });
    const handle = wd.watch(join(TMP_DIR, "nonexistent"));

    const result = await handle.hung;
    alive.clear();
    expect(result).toBe("hung");
  });

  it("never resolves when path exists before timeout", async () => {
    mkdirSync(TMP_DIR, { recursive: true });
    const alive = keepAlive(500);
    try {
      const wd = new WorktreeWatchdog({ timeoutMs: 100, pollMs: 20 });
      const handle = wd.watch(TMP_DIR); // already exists

      const result = await Promise.race([
        handle.hung,
        new Promise<"ok">((r) => setTimeout(() => r("ok"), 200)),
      ]);

      handle.cancel();
      expect(result).toBe("ok");
    } finally {
      alive.clear();
      rmSync(TMP_DIR, { recursive: true, force: true });
    }
  });

  it("never resolves when path appears during polling", async () => {
    const targetDir = join(TMP_DIR, "delayed");
    rmSync(TMP_DIR, { recursive: true, force: true });
    const alive = keepAlive(1000);

    const wd = new WorktreeWatchdog({ timeoutMs: 500, pollMs: 20 });
    const handle = wd.watch(targetDir);

    // Create the dir after 50ms (within the 500ms timeout)
    setTimeout(() => mkdirSync(targetDir, { recursive: true }), 50);

    const result = await Promise.race([
      handle.hung,
      new Promise<"ok">((r) => setTimeout(() => r("ok"), 600)),
    ]);

    handle.cancel();
    alive.clear();
    rmSync(TMP_DIR, { recursive: true, force: true });
    expect(result).toBe("ok");
  });

  it("cancel stops the interval", async () => {
    const alive = keepAlive(500);
    const wd = new WorktreeWatchdog({ timeoutMs: 200, pollMs: 20 });
    const handle = wd.watch(join(TMP_DIR, "cancelled"));

    handle.cancel();

    // After cancelling, hung should never resolve even past the timeout
    const result = await Promise.race([
      handle.hung,
      new Promise<"ok">((r) => setTimeout(() => r("ok"), 300)),
    ]);

    alive.clear();
    expect(result).toBe("ok");
  });

  it("exposes timeoutSec", () => {
    const wd = new WorktreeWatchdog({ timeoutMs: 3000 });
    expect(wd.timeoutSec).toBe(3);
  });
});
