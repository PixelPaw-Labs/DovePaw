/**
 * A2A client helpers shared across query-tools MCP tool factories.
 *
 *   resolveAgentPort      — port lookup from the ports manifest
 *   createAgentClient     — create A2A Client for a port
 *   subscribeTaskStream   — resubscribe + collect stream, cancels on abort
 *   collectStreamResult   — consume A2A event stream → StreamedResult
 *   extractArtifactResult — build StreamedResult from terminal task artifacts
 */

import type { Artifact } from "@a2a-js/sdk";
import type { Client } from "@a2a-js/sdk/client";
import type { A2AStreamEvent } from "@@/lib/a2a-client";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import type { PortsManifest } from "@/a2a/lib/ports-manifest";
import { TRANSIENT_ARTIFACT_NAMES, ARTIFACT } from "@/lib/query-dispatcher";
import type { ProgressEntry } from "@/lib/progress";
export type { ProgressEntry } from "@/lib/progress";
export { createAgentClient, startAgentStream } from "@@/lib/a2a-client";
export type { A2AStreamEvent, AgentStreamHandle } from "@@/lib/a2a-client";

export type StreamedResult = {
  /** Primary text output (from artifact-update events), joined for readability. */
  output: string;
  /** Progress messages, each carrying its linked artifacts inline. */
  progress: ProgressEntry[];
};

function getManifestPort(manifest: PortsManifest, key: string): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(manifest, key)) return undefined;
  const val = (manifest as Record<string, unknown>)[key];
  return typeof val === "number" ? val : undefined;
}

/** Resolve agent port from the ports manifest, or null if servers are unavailable. */
export function resolveAgentPort(manifestKey: string): number | null {
  const manifest = readPortsManifest();
  if (!manifest) return null;
  return getManifestPort(manifest, manifestKey) ?? null;
}

/**
 * Subscribe to a task's live event stream, forwarding snapshots via onProgress.
 * Aborts the stream and cancels the task when signal fires.
 */
export function subscribeTaskStream(
  client: Client,
  taskId: string,
  signal: AbortSignal | undefined,
  onProgress: (result: StreamedResult) => void,
  onArtifact?: (name: string, text: string) => void,
): Promise<{ taskId?: string; result: StreamedResult }> {
  const ac = new AbortController();
  signal?.addEventListener(
    "abort",
    () => {
      ac.abort();
      void client.cancelTask({ id: taskId }).catch(() => {});
    },
    { once: true },
  );
  return collectStreamResult(
    client.resubscribeTask({ id: taskId }, { signal: ac.signal }),
    onProgress,
    onArtifact,
  );
}

function accumulate(target: Record<string, string>, name: string, text: string): void {
  target[name] = target[name] ? `${target[name]}\n${text}` : text;
}

/**
 * Consume an A2A event stream, building a StreamedResult.
 * Calls onSnapshot after each status-update or artifact-update so callers can
 * forward live progress to the UI.
 */
export async function collectStreamResult(
  stream: AsyncGenerator<A2AStreamEvent, void, undefined>,
  onSnapshot?: (result: StreamedResult) => void,
  onArtifact?: (name: string, text: string) => void,
  onComplete?: (result: StreamedResult) => void,
): Promise<{ taskId?: string; result: StreamedResult }> {
  let taskId: string | undefined;
  const progress: ProgressEntry[] = [];
  let pendingEntry: ProgressEntry | undefined;

  const snapshot = (): StreamedResult => {
    const output = progress
      .flatMap((e) =>
        Object.entries(e.artifacts)
          .filter(([name]) => name !== ARTIFACT.TOOL_CALL)
          .map(([, v]) => v),
      )
      .join("\n")
      .trim();
    return {
      output: output || "Something wrong with agent.",
      progress: progress.map((e) => ({ ...e, artifacts: { ...e.artifacts } })),
    };
  };

  for await (const event of stream) {
    if (event.kind === "task") {
      taskId = event.id;
    } else if (event.kind === "artifact-update") {
      const name = event.artifact.name ?? "";
      for (const p of event.artifact.parts) {
        if (p.kind === "text") {
          onArtifact?.(name, p.text);
          // final-output must always be captured. A resumed session may respond
          // without any tool calls, so pendingEntry may never be set — create an
          // implicit entry to hold it rather than dropping the artifact.
          if (name === ARTIFACT.FINAL_OUTPUT && !pendingEntry) {
            pendingEntry = { message: "", artifacts: {} };
            progress.push(pendingEntry);
          }
          if (pendingEntry && !(TRANSIENT_ARTIFACT_NAMES as Set<string>).has(name)) {
            accumulate(pendingEntry.artifacts, name, p.text);
            onSnapshot?.(snapshot());
          }
        }
      }
    } else if (event.kind === "status-update") {
      if (event.status.message) {
        for (const p of event.status.message.parts) {
          if (p.kind === "text") {
            const entry: ProgressEntry = { message: p.text, artifacts: {} };
            progress.push(entry);
            pendingEntry = entry;
            onSnapshot?.(snapshot());
          }
        }
      }
    }
  }

  onComplete?.(snapshot());
  return { taskId, result: snapshot() };
}

/** Build a StreamedResult from terminal task artifacts (no live stream needed). */
export function extractArtifactResult(rawArtifacts: Artifact[] | undefined): StreamedResult {
  const artifacts: Record<string, string> = {};
  for (const a of rawArtifacts ?? []) {
    const name = a.name ?? "";
    for (const p of a.parts) {
      if (p.kind === "text")
        artifacts[name] = artifacts[name] ? `${artifacts[name]}\n${p.text}` : p.text;
    }
  }
  // Prefer final-output (complete response), fall back to stream (accumulated text deltas).
  // Never include tool-call, tool-input, or thinking in the text output.
  const output =
    (artifacts[ARTIFACT.FINAL_OUTPUT] || artifacts[ARTIFACT.STREAM] || "").trim() ||
    "Something wrong with agent.";
  return { output, progress: [] };
}
