/**
 * Agent script spawning utilities.
 *
 * Kept in a separate module so executors (query-agent-executor, script-agent-executor)
 * can import these without creating a circular dependency with base-server.
 */

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { TSX_BIN } from "@/lib/paths";

/** Sentinel prefix written by agent scripts via emitProgress(). */
export const PROGRESS_PREFIX = "__PROGRESS__:";

/**
 * Route a single stdout line: progress sentinels go to onProgress and are
 * excluded from the collected output; all other lines go to lines[] and onLine.
 */
export function processOutputLine(
  line: string,
  lines: string[],
  onLine?: (line: string) => void,
  onProgress?: (message: string) => void,
): void {
  if (line.startsWith(PROGRESS_PREFIX)) {
    onProgress?.(line.slice(PROGRESS_PREFIX.length));
  } else {
    lines.push(line);
    onLine?.(line);
  }
}

// ─── AgentConfig ──────────────────────────────────────────────────────────────

export interface AgentConfig {
  scriptPath: string;
  agentName: string;
  whatItDoes: string;
  /** Resolved env vars from settings to merge into the spawned process environment. */
  extraEnv?: Record<string, string>;
  /** The workspace directory for this run — used as cwd when spawning the agent script. */
  workspacePath: string;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Extract the plain text instruction from an A2A user message's parts. */
export function extractInstruction(parts: { kind: string; text?: string }[]): string {
  return parts
    .filter((p) => p.kind === "text")
    .map((p) => p.text ?? "")
    .join(" ")
    .trim();
}

/** Build the argv array for spawning the agent script. */
export function buildScriptArgs(scriptPath: string, instruction: string): string[] {
  return instruction ? [scriptPath, instruction] : [scriptPath];
}

// ─── Script run structured content types ──────────────────────────────────────

export type ScriptCompletedContent = {
  status: "completed";
  runId: string;
  output: string;
};

export type ScriptStillRunningContent = {
  status: "still_running";
  runId: string;
  /** Last lines of script output captured so far, for progress reporting. */
  latestOutput?: string;
};

export type ScriptNotFoundContent = {
  status: "not_found";
  runId: string;
};

export type AwaitScriptContent =
  | ScriptCompletedContent
  | ScriptStillRunningContent
  | ScriptNotFoundContent;

// ─── Script process registry ──────────────────────────────────────────────────

/** How long to wait for script completion before returning still_running. */
export const SCRIPT_POLL_TIMEOUT_MS = 30_000;

type ScriptState =
  | { phase: "running"; promise: Promise<string>; latestLines: string[] }
  | { phase: "done"; output: string };

/**
 * Tracks script runs until the caller collects the result via awaitScript.
 *
 * Entries move from "running" → "done" when the process exits, and are
 * deleted only after awaitScript successfully returns the output. This
 * prevents awaitScript from returning "not_found" when called after the
 * script exits but before the result has been collected.
 */
const runningScripts = new Map<string, ScriptState>();

export function hasPendingScripts(): boolean {
  return runningScripts.size > 0;
}

export function getPendingRunIds(): string[] {
  return [...runningScripts.keys()];
}

// ─── spawnAndCollect ──────────────────────────────────────────────────────────

/**
 * Spawns the agent tsx script and collects all stdout/stderr into a single string.
 * Used by the run_script MCP tool inside QueryAgentExecutor.
 *
 * @param onLine Optional callback invoked for each line as it arrives (stdout + stderr).
 *   Used by startScript to maintain a live latestLines snapshot for progress reporting.
 * @param onProgress Optional callback invoked when a `__PROGRESS__:<message>` sentinel
 *   line is detected. Progress lines are stripped from the collected output.
 */
export async function spawnAndCollect(
  config: AgentConfig,
  instruction: string,
  signal?: AbortSignal,
  onLine?: (line: string) => void,
  onProgress?: (message: string) => void,
): Promise<string> {
  if (!existsSync(config.scriptPath)) {
    return `Script not found: ${config.scriptPath}`;
  }

  const tsxBin = existsSync(TSX_BIN) ? TSX_BIN : "tsx";
  const scriptArgs = buildScriptArgs(config.scriptPath, instruction);
  const proc = spawn(tsxBin, scriptArgs, {
    env: { ...process.env, ...config.extraEnv },
    cwd: config.workspacePath,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  const killProc = () => {
    try {
      process.kill(-proc.pid!, "SIGTERM");
    } catch {
      proc.kill("SIGTERM");
    }
  };

  if (signal?.aborted) {
    killProc();
  } else {
    signal?.addEventListener("abort", killProc, { once: true });
  }

  const lines: string[] = [];

  return new Promise<string>((resolve) => {
    let stdoutBuf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const parts = stdoutBuf.split("\n");
      stdoutBuf = parts.pop() ?? "";
      parts.filter((l) => l.trim()).forEach((l) => processOutputLine(l, lines, onLine, onProgress));
    });

    let stderrBuf = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const parts = stderrBuf.split("\n");
      stderrBuf = parts.pop() ?? "";
      parts
        .filter((l) => l.trim())
        .forEach((l) => {
          const prefixed = `[stderr] ${l}`;
          lines.push(prefixed);
          onLine?.(prefixed);
        });
    });

    proc.on("close", (code) => {
      if (stdoutBuf.trim()) lines.push(stdoutBuf.trim());
      if (stderrBuf.trim()) lines.push(`[stderr] ${stderrBuf.trim()}`);
      resolve(
        lines.length > 0
          ? lines.join("\n")
          : `${config.agentName} finished (exit code ${code ?? "?"}).`,
      );
    });

    proc.on("error", (err) => {
      resolve(`Spawn error: ${err.message}`);
    });
  });
}

// ─── startScript / awaitScript ────────────────────────────────────────────────

/**
 * Spawns the agent script in the background and returns a runId immediately.
 * Use awaitScript to poll for the result.
 */
export function startScript(
  config: AgentConfig,
  instruction: string,
  signal?: AbortSignal,
  onProgress?: (message: string) => void,
): { runId: string } {
  const runId = randomUUID();
  const latestLines: string[] = [];

  // Spawn with a line callback so latestLines stays fresh during the run.
  const promise = spawnAndCollect(
    config,
    instruction,
    signal,
    (line) => {
      latestLines.push(line);
      // Keep only the last 20 lines to bound memory.
      if (latestLines.length > 20) latestLines.shift();
    },
    onProgress,
  );

  runningScripts.set(runId, { phase: "running", promise, latestLines });
  // Cache the output when the process exits so awaitScript can collect it
  // even if the script finishes before the next poll (avoids "not_found").
  void promise.then((output) => {
    runningScripts.set(runId, { phase: "done", output });
  });
  return { runId };
}

/**
 * Polls a previously started script run for up to SCRIPT_POLL_TIMEOUT_MS.
 * Returns the output if complete, still_running if still in progress, or
 * not_found if the runId is unknown.
 *
 * The entry is removed from the registry only after this function returns
 * the final output — keeping hasPendingScripts() accurate for the Stop hook.
 */
export async function awaitScript(runId: string): Promise<AwaitScriptContent> {
  const state = runningScripts.get(runId);
  if (!state) return { status: "not_found", runId };

  // Script already finished between polls — return cached output and clean up.
  if (state.phase === "done") {
    runningScripts.delete(runId);
    return { status: "completed", runId, output: state.output };
  }

  const timeoutResult = Symbol("timeout");
  const result = await Promise.race([
    state.promise.then(
      (output): ScriptCompletedContent => ({ status: "completed", runId, output }),
    ),
    new Promise<typeof timeoutResult>((resolve) =>
      setTimeout(() => resolve(timeoutResult), SCRIPT_POLL_TIMEOUT_MS),
    ),
  ]);

  if (result === timeoutResult) {
    const latestOutput = state.latestLines.slice(-10).join("\n") || undefined;
    return { status: "still_running", runId, latestOutput };
  }

  // Completed within the poll window — clean up now.
  runningScripts.delete(runId);
  return result;
}
