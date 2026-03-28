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

/** In-flight script runs: runId → output promise (resolves when process exits). */
const runningScripts = new Map<string, Promise<string>>();

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
 */
export async function spawnAndCollect(config: AgentConfig, instruction: string): Promise<string> {
  if (!existsSync(config.scriptPath)) {
    return `Script not found: ${config.scriptPath}`;
  }

  const tsxBin = existsSync(TSX_BIN) ? TSX_BIN : "tsx";
  const scriptArgs = buildScriptArgs(config.scriptPath, instruction);
  const proc = spawn(tsxBin, scriptArgs, {
    env: { ...process.env, ...config.extraEnv },
    cwd: config.workspacePath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines: string[] = [];

  return new Promise<string>((resolve) => {
    let stdoutBuf = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const parts = stdoutBuf.split("\n");
      stdoutBuf = parts.pop() ?? "";
      parts.filter((l) => l.trim()).forEach((l) => lines.push(l));
    });

    let stderrBuf = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const parts = stderrBuf.split("\n");
      stderrBuf = parts.pop() ?? "";
      parts.filter((l) => l.trim()).forEach((l) => lines.push(`[stderr] ${l}`));
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
export function startScript(config: AgentConfig, instruction: string): { runId: string } {
  const runId = randomUUID();
  const outputPromise = spawnAndCollect(config, instruction).finally(() => {
    runningScripts.delete(runId);
  });
  runningScripts.set(runId, outputPromise);
  return { runId };
}

/**
 * Polls a previously started script run for up to SCRIPT_POLL_TIMEOUT_MS.
 * Returns the output if complete, still_running if still in progress, or
 * not_found if the runId is unknown.
 */
export async function awaitScript(runId: string): Promise<AwaitScriptContent> {
  const outputPromise = runningScripts.get(runId);
  if (!outputPromise) return { status: "not_found", runId };

  const timeoutResult = Symbol("timeout");
  const result = await Promise.race([
    outputPromise.then(
      (output): ScriptCompletedContent => ({ status: "completed", runId, output }),
    ),
    new Promise<typeof timeoutResult>((resolve) =>
      setTimeout(() => resolve(timeoutResult), SCRIPT_POLL_TIMEOUT_MS),
    ),
  ]);

  if (result === timeoutResult) return { status: "still_running", runId };
  return result;
}
