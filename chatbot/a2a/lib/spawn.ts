/**
 * Agent script spawning utilities.
 *
 * Kept in a separate module so executors (query-agent-executor, script-agent-executor)
 * can import these without creating a circular dependency with base-server.
 */

import { existsSync } from "node:fs";
import { extname } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { TSX_BIN } from "@/lib/paths";
import type { AgentConfig } from "./agent-config-builder";
export type {
  ScriptCompletedContent,
  ScriptStillRunningContent,
  ScriptNotFoundContent,
  AwaitScriptContent,
} from "@/lib/script-types";
import type { ScriptCompletedContent, AwaitScriptContent } from "@/lib/script-types";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Build the argv array for spawning the agent script. */
export function buildScriptArgs(scriptPath: string, instruction: string): string[] {
  return instruction ? [scriptPath, instruction] : [scriptPath];
}

/** Resolve the runtime command and base args for a given script path based on its extension. */
export function resolveRuntime(scriptPath: string): { cmd: string; args: string[] } {
  const ext = extname(scriptPath);
  if (ext === ".sh") return { cmd: "bash", args: [scriptPath] };
  if (ext === ".py") return { cmd: "python3", args: [scriptPath] };
  if (ext === ".rb") return { cmd: "ruby", args: [scriptPath] };
  const tsxBin = existsSync(TSX_BIN) ? TSX_BIN : "tsx";
  return { cmd: tsxBin, args: [scriptPath] };
}

// ─── Script process registry ──────────────────────────────────────────────────

/** How long to wait for script completion before returning still_running. */
export const SCRIPT_POLL_TIMEOUT_MS = 30_000;

/** Maximum lines kept in the live progress buffer — prevents unbounded growth. */
const LATEST_LINES_CAP = 200;

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
 * Returns { promise, lines } so the caller can use lines[] as a live buffer
 * without needing a per-line callback.
 *
 * Agent scripts emit progress via HTTP POST to the A2A server (DOVEPAW_A2A_PORT +
 * DOVEPAW_TASK_ID env vars), not via stdout sentinels.
 */
export function spawnAndCollect(
  config: AgentConfig,
  instruction: string,
  signal?: AbortSignal,
): { promise: Promise<string>; lines: string[] } {
  const lines: string[] = [];

  if (!existsSync(config.scriptPath)) {
    return { promise: Promise.resolve(`Script not found: ${config.scriptPath}`), lines };
  }

  const { cmd, args: baseArgs } = resolveRuntime(config.scriptPath);
  const scriptArgs = instruction ? [...baseArgs, instruction] : baseArgs;
  const proc = spawn(cmd, scriptArgs, {
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

  const promise = new Promise<string>((resolve) => {
    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      lines.push(line);
      while (lines.length > LATEST_LINES_CAP) lines.shift();
    });

    const rlErr = createInterface({ input: proc.stderr, crlfDelay: Infinity });
    rlErr.on("line", (line) => {
      lines.push(`[stderr] ${line}`);
      while (lines.length > LATEST_LINES_CAP) lines.shift();
    });

    proc.on("close", (code) => {
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

  return { promise, lines };
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
  runId: string = randomUUID(),
): { runId: string } {
  const { promise, lines: latestLines } = spawnAndCollect(config, instruction, signal);

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
  let timerId: ReturnType<typeof setTimeout>;
  const result = await Promise.race([
    state.promise.then(
      (output): ScriptCompletedContent => ({ status: "completed", runId, output }),
    ),
    new Promise<typeof timeoutResult>((resolve) => {
      timerId = setTimeout(() => resolve(timeoutResult), SCRIPT_POLL_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timerId));

  if (result === timeoutResult) {
    const latestOutput = state.latestLines.slice(-10).join("\n") || undefined;
    return { status: "still_running", runId, latestOutput };
  }

  // Completed within the poll window — clean up now.
  runningScripts.delete(runId);
  return result;
}
