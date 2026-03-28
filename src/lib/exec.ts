import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr?: string;
  code?: string | number | null;
}

export async function exec(
  cmd: string,
  args: string[],
  opts: Record<string, unknown> = {},
): Promise<ExecResult> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout: 30_000,
      ...opts,
    } as Parameters<typeof execFileAsync>[2]);
    return { ok: true, stdout: String(stdout).trim() };
  } catch (err: unknown) {
    const e = typeof err === "object" && err !== null ? err : {};
    const stdout = "stdout" in e && typeof e.stdout === "string" ? e.stdout : "";
    const stderr = "stderr" in e && typeof e.stderr === "string" ? e.stderr : "";
    const code =
      "code" in e && (typeof e.code === "string" || typeof e.code === "number") ? e.code : null;
    return { ok: false, stdout: stdout.trim(), stderr: stderr.trim(), code };
  }
}
