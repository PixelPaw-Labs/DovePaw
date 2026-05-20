/**
 * SSE heartbeat — pings each agent's A2A agent-card endpoint every INTERVAL_MS,
 * reads processing state from PROCESSING_FILE (written by processing-registry.ts
 * on every state change), and streams results to browser clients.
 *
 * Runs entirely in the Next.js process — no dependency on the A2A heartbeat server
 * or any shared intermediate file for the main ping data.
 */

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { PROCESSING_FILE } from "@/lib/paths";
import { readPortsManifest } from "@/a2a/lib/ports-manifest";
import { getSchedulerStatuses } from "@/lib/agent-scheduler";
import type { AgentStatus, StatusMessage } from "@/a2a/heartbeat-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERVAL_MS = 10_000;
const PING_TIMEOUT_MS = 5_000;

async function pingAgent(port: number): Promise<Pick<AgentStatus, "online" | "latency">> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(`http://localhost:${port}/.well-known/agent-card.json`, {
      signal: controller.signal,
    });
    return { online: res.ok, latency: Date.now() - t0 };
  } catch {
    return { online: false, latency: null };
  } finally {
    clearTimeout(timer);
  }
}

const processingStateSchema = z.record(
  z.string(),
  z.object({
    processing: z.boolean(),
    processingTrigger: z.enum(["scheduled", "dove"]).nullable(),
  }),
);
type ProcessingState = z.infer<typeof processingStateSchema>;

function readProcessingState(): ProcessingState {
  try {
    if (!existsSync(PROCESSING_FILE)) return {};
    const raw: unknown = JSON.parse(readFileSync(PROCESSING_FILE, "utf-8"));
    const result = processingStateSchema.safeParse(raw);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

async function checkAll(): Promise<Record<string, AgentStatus>> {
  const manifest = readPortsManifest();
  if (!manifest) return {};

  const agentPorts = Object.entries(manifest).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );
  if (agentPorts.length === 0) return {};

  const processingMap = readProcessingState();
  const [pingResults, schedulerMap] = await Promise.all([
    Promise.all(agentPorts.map(([, port]) => pingAgent(port))),
    getSchedulerStatuses(),
  ]);

  return Object.fromEntries(
    agentPorts.map(([k], i) => [
      k,
      {
        ...pingResults[i],
        scheduler: schedulerMap[k] ?? null,
        processing: processingMap[k]?.processing ?? false,
        processingTrigger: processingMap[k]?.processingTrigger ?? null,
      },
    ]),
  );
}

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      // Prevent concurrent tick() executions. If checkAll() (which spawns launchctl
      // and opens agent HTTP connections) takes longer than INTERVAL_MS, skipping
      // the next tick is better than stacking concurrent child processes / FDs.
      let ticking = false;

      function send(agents: Record<string, AgentStatus>) {
        const msg: StatusMessage = { type: "status", agents };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
      }

      async function tick() {
        if (closed || ticking) return;
        ticking = true;
        try {
          const agents = await checkAll();
          if (!closed) send(agents);
        } finally {
          ticking = false;
        }
      }

      void tick();
      const timer = setInterval(() => void tick(), INTERVAL_MS);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
