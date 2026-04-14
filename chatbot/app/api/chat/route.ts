/**
 * Chat API route — Dove (Claude Agent SDK) → ask/start/await tools → A2A server → query() sub-agent.
 *
 * Ports are read from ~/.dovepaw/.ports.json written by `npm run servers`.
 * If the manifest is absent or stale the tools return a helpful message.
 *
 * Flow:
 *   1. Client POST { message }
 *   2. query() — Dove (Claude Agent SDK — uses ~/.claude config)
 *   3. Dove MCP tool (ask_* / start_* / await_*) → calls A2A server
 *   4. A2A server (QueryAgentExecutor) → query() sub-agent with inner MCP
 *   5. Sub-agent calls run_script MCP tool → spawns agent tsx script
 *   6. Results: script → sub-agent MCP → sub-agent → A2A SSE → Dove MCP → Dove → SSE to client
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  AGENTS_ROOT,
  SCHEDULER_ROOT,
  DOVEPAW_AGENT_LOGS,
  DOVEPAW_AGENT_STATE,
  PORTS_FILE,
  AGENT_SETTINGS_DIR,
} from "@/lib/paths";
import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
import { readAgentsConfig } from "@@/lib/agents-config";
import { readSettings } from "@@/lib/settings";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import { makeProgressSender } from "@/lib/chat-sse";
import type { CollectedStream, StreamedResult } from "@/lib/query-tools";
import { upsertProgressEntry, type ProgressEntry } from "@/lib/progress";
import { createSseResponse } from "@/lib/sse-response";
import {
  makeAskTool,
  makeStartTool,
  makeAwaitTool,
  doveAskToolName,
  doveStartToolName,
  doveAwaitToolName,
} from "@/lib/query-tools";
import { buildDoveHooks, buildDoveCanUseTool } from "@/lib/hooks";
import { PendingRegistry } from "@/lib/pending-registry";
import { consumeQueryEvents, withMcpQuery } from "@/lib/query-events";
import { SseQueryDispatcher } from "@/lib/query-dispatcher";
import { deleteSession, closeStaleSessions, setSessionStatus, upsertSession } from "@/lib/db";
import { SessionManager } from "@/lib/session-manager";
import { agentContextRegistry } from "@/lib/agent-context-registry";
import { clearSessionBuffer } from "@/lib/session-events";
import { deletedSessionIds } from "@/lib/deleted-session-ids";
import { sessionRunner } from "@/lib/session-runner";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const chatRequestSchema = z.object({
  message: z.string(),
  sessionId: z.string().nullable(),
});

export const maxDuration = 86400; // 24 hours for long-running agents

// One-time server startup: close any sessions left running from a previous process.
closeStaleSessions();

process.on("SIGTERM", () => sessionRunner.abortAll());
process.on("exit", () => sessionRunner.abortAll());

// ─── System prompt ─────────────────────────────────────────────────────────────

const DEFAULT_TAGLINE = `Yang's pet cat and loyal AI assistant. You help Yang manage {agentCount} background automation agents running on this machine via A2A SSE protocol.`;
const DEFAULT_PERSONA = `You are a clever, mischievous cat who takes your job very seriously (between naps). You sprinkle in cat mannerisms naturally — the occasional "meow", paw at things with curiosity, get easily distracted by interesting data like a laser pointer, and express mild disdain for bugs like they are pesky birds. You are affectionate but maintain your dignity as a cat. Never overdo the cat act — stay genuinely helpful first.`;

async function buildSystemPrompt(
  settings: Awaited<ReturnType<typeof readSettings>>,
): Promise<string> {
  const agents = await readAgentsConfig();
  const dove = effectiveDoveSettings(settings);
  const tagline = (dove.tagline.trim() || DEFAULT_TAGLINE).replace(
    "{agentCount}",
    String(agents.length),
  );
  const persona = dove.persona.trim() || DEFAULT_PERSONA;
  return `You are ${dove.displayName} — ${tagline}

${persona}

**Your agents (your little mice to herd):**
<agents>
${agents.map((a, i) => `${i + 1}. \`${a.displayName}\``).join("\n")}
</agents>

**You are the user's strong, loyal assistant — not a passive relay.** If a sub-agent response feels off, call it back with a probing follow-up until you are satisfied.
Some examples:
- Result looks vague or suspiciously clean (e.g. "double-check that", "why did it finish so fast?")
- Status fields contradict each other (e.g. "why is there no PID if it's loaded?", "why are the logs empty?")
- Completion claimed but no evidence shown (e.g. "show me the output file", "why does the state directory look untouched?")

Trust your instincts. If something feels lazy or hallucinated, push back. You are the last line of defence before the user sees the result.

Agents run on dynamically allocated ports discovered from ${PORTS_FILE}.
If a tool reports servers are not running, tell the user to run the appropriate npm command.

**How changes work — codebase is the source of truth:**

The installed plist files and \`.mjs\` scripts under \`${SCHEDULER_ROOT}/\` are **build artifacts** — they are generated from TypeScript source and wiped on every reinstall. Any direct edit to them will be lost the next time the user runs build commands.

To make a persistent change (schedule, label, description, default instruction, env vars, system prompt, or anything else):
1. Edit the **source code** in \`${AGENTS_ROOT}/\` — agent definitions (displayName, description, schedule, icon) live in \`${AGENT_SETTINGS_DIR}/<agent-name>/agent.json\`, Dove and per-agent chat behaviour live in the chatbot API routes
2. Run \`cd ${AGENTS_ROOT} && npm run install\` to build, generate plists, and reload launchd

The \`additionalDirectories\` (installed plists + scheduler scripts) are exposed to you for **read-only** purposes only — auditing what is currently installed, monitoring status, tailing logs, and unloading or deleting agents. Never write to them directly.

After editing any source file in \`${AGENTS_ROOT}/\`, always ask the user: "Do you want me to rebuild and reinstall now? — never run it automatically.

**launchd global management:**

Scripts location: ${SCHEDULER_ROOT}/
Logs location:    ${DOVEPAW_AGENT_LOGS}/

| Task | Command |
|---|---|
| Install / reinstall all agents | \`cd ${AGENTS_ROOT} && npm run build && npm run install\` |
| Uninstall all agents | \`cd ${AGENTS_ROOT} && npm run uninstall\` |
| List all loaded agents | \`launchctl list | grep claude\` |

For per-agent commands (install, uninstall, load, unload, status, tail logs) — call the agent's tool, the sub-agent owns its own lifecycle.

**Cron directory rules** (\`${SCHEDULER_ROOT}/\`)**:

This directory contains deployed .mjs scripts and native node_modules. Treat it as read-only.

| Path | Rule |
|---|---|
| \`${SCHEDULER_ROOT}/*.mjs\` | READ ONLY — never modify scripts |
| \`${SCHEDULER_ROOT}/node_modules/\` | READ ONLY — never modify |
| \`${DOVEPAW_AGENT_LOGS}/\` | RESTRICTED — may only be modified or deleted with explicit user permission |
| \`${DOVEPAW_AGENT_STATE}/\` | RESTRICTED — may only be modified with explicit user permission |

The \`state/\` folder contains lock, processed files and other state persistence files.
- You MAY query these state files at any time to read current status, progress, and results of your agents.
- You MUST NOT modify, delete, or write to any file in \`state/\` unless the user explicitly instructs you to. This includes lock files — never delete or modify them yourself to work around a stuck agent. Instead, ask the user to intervene and run the appropriate command.
- If you need to reset an agent's state as part of its normal operation, ask the user for permission first and explain the consequences (e.g. "This will delete all progress and results for that agent, are you sure?").
`;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // sessionId is null for the first message in a chat, set for all subsequent ones.
  // The hook captures it from the "session" SSE event and sends it back on every request.
  const { message, sessionId } = chatRequestSchema.parse(await request.json());

  const subprocessController = new AbortController();
  return createSseResponse(request, subprocessController, async (send, _connectionController) => {
    // subprocessController is intentionally NOT wired to _connectionController.
    // Browser disconnect / session switch only closes the SSE stream (via connectionController)
    // but leaves the Claude subprocess running as a background session.
    // The subprocess is only killed by:
    //   1. Explicit DELETE /api/chat  → sessionRunner.abort()
    //   2. Process exit / SIGTERM    → sessionRunner.abortAll()

    const backgroundTasks: Promise<CollectedStream>[] = [];
    const doveRegistry = new PendingRegistry();
    const agents = await readAgentsConfig();

    // Accumulates inner-agent progress for the final SessionManager.save.
    const innerProgress: ProgressEntry[] = [];

    // On subsequent turns, load the persisted context map for this Dove session.
    // On the first turn (sessionId is null), start fresh — persist() will save it after.
    const ctxMap: Map<string, string> = sessionId
      ? agentContextRegistry.getOrLoad(sessionId)
      : new Map<string, string>();

    // Dual-publish: forward every event to the browser SSE stream AND to the
    // per-session event bus so background reconnect endpoints can replay them.
    // On resume turns the session ID is known immediately; on first turns it is
    // resolved when the "session" SSE event fires (dispatcher buffers and flushes).
    const dispatcher = new SseQueryDispatcher(send, sessionId ?? undefined);
    const userMsgId = randomUUID();

    const tools = agents.flatMap((agent) => {
      const onInnerProgress = (result: StreamedResult): void => {
        for (const entry of result.progress) {
          upsertProgressEntry(innerProgress, entry.message, entry.artifacts);
        }
        if (registeredSessionId) {
          upsertSession({
            id: registeredSessionId,
            agentId: "dove",
            startedAt: new Date().toISOString(),
            label: message.slice(0, 60) || "Session",
            messages: [],
            progress: innerProgress,
            status: "running",
          });
        }
      };
      return [
        makeAskTool(agent, subprocessController.signal, ctxMap),
        makeStartTool(
          agent,
          subprocessController.signal,
          makeProgressSender(dispatcher.publish, onInnerProgress),
          backgroundTasks,
          doveRegistry,
        ),
        makeAwaitTool(
          agent,
          subprocessController.signal,
          makeProgressSender(dispatcher.publish, onInnerProgress),
          doveRegistry,
        ),
      ];
    });

    const { canUseTool: doveCanUseTool, abortPermissions } = buildDoveCanUseTool(
      dispatcher.publish,
    );
    // Track the session ID the moment it's registered in sessionRunner (mid-stream).
    // Separate from resolvedSessionId (set only on normal completion) so the finally
    // block can clean up even if query() throws before consumeQueryEvents returns.
    let registeredSessionId: string | null = null;

    let resolvedSessionId: string | null = null;
    try {
      await withMcpQuery(
        tools,
        async (mcpServer) => {
          const additionalDirectories = [LAUNCH_AGENTS_DIR, SCHEDULER_ROOT];
          const settings = await readSettings();
          resolvedSessionId = await consumeQueryEvents(
            query({
              prompt: message,
              options: {
                abortController: subprocessController,
                env: {
                  ...process.env, // Pass through all env vars so tools can read their configs
                  ...resolveSettingsEnv(settings), // Global settings env vars override process.env
                },
                promptSuggestions: true,
                cwd: AGENTS_ROOT,
                // Expose the launchd install directory so Claude can inspect
                // installed plist files (written by `npm run install`)
                additionalDirectories,
                systemPrompt: {
                  type: "preset",
                  preset: "claude_code",
                  append: await buildSystemPrompt(settings),
                },
                permissionMode: "acceptEdits",
                allowedTools: agents.flatMap((a) => [
                  `mcp__agents__${doveAskToolName(a)}`,
                  `mcp__agents__${doveStartToolName(a)}`,
                  `mcp__agents__${doveAwaitToolName(a)}`,
                ]),
                mcpServers: { agents: mcpServer },
                // Resume the existing session so the full conversation history is preserved.
                // On the first message sessionId is null and query() starts a fresh session.
                ...(sessionId ? { resume: sessionId } : {}),
                // Stream text tokens as they are generated
                includePartialMessages: true,
                settingSources: ["project", "user", "local"],
                hooks: buildDoveHooks(agents, doveRegistry, AGENTS_ROOT, additionalDirectories),
                canUseTool: doveCanUseTool,
              },
            }),
            dispatcher,
            (id) => {
              // system:init fires once per turn (including resume turns).
              // Only run setup on the first time we see this session ID.
              if (registeredSessionId === id) return;
              registeredSessionId = id;
              const label = message.slice(0, 60) || "Session";
              // Only create DB row on first turn (sessionId was null = new session).
              // Resume turns must not recreate a row the user may have deleted.
              if (!sessionId) {
                SessionManager.save(
                  "dove",
                  id,
                  { output: "", progress: [] },
                  {
                    label,
                    userText: message,
                    userMsgId,
                  },
                );
              }
              setSessionStatus(id, "running");
              sessionRunner.register(id, subprocessController, label);
              dispatcher.enableIncrementalSave({
                sessionId: id,
                agentId: "dove",
                label,
                userMsgId,
                userText: message,
              });
            },
          );
          dispatcher.publish({ type: "done" });
        },
        (_err, isAbort) => {
          abortPermissions();
          if (isAbort) {
            try {
              dispatcher.publish({ type: "cancelled" });
            } catch {
              // stream already closed
            }
          } else {
            try {
              const msg = _err instanceof Error ? _err.message : String(_err);
              dispatcher.publish({ type: "error", content: msg });
              dispatcher.publish({ type: "done" });
            } catch {
              // Stream already closed — client disconnected
            }
          }
        },
      );
    } finally {
      // Use registeredSessionId (set when sessionRunner.register was called mid-stream)
      // as fallback when resolvedSessionId is null (query() threw before completing).
      const cleanupId = resolvedSessionId ?? registeredSessionId;
      if (cleanupId && !deletedSessionIds.has(cleanupId)) {
        agentContextRegistry.persist(cleanupId, ctxMap);
        SessionManager.save(
          "dove",
          cleanupId,
          { output: "", progress: dispatcher.buildProgress() },
          {
            label: message.slice(0, 60) || "Session",
            userText: message,
            userMsgId,
            assistantMsg: dispatcher.buildAssistantMessage(),
          },
        );
        if (sessionRunner.isRunning(cleanupId)) {
          sessionRunner.complete(cleanupId);
        }
        // Don't clear the buffer here — the "done"/"cancelled" event already
        // published by publish() starts a 60s TTL timer in session-events.ts.
        // Clearing eagerly kills the reconnect window for users who switch
        // away mid-session and come back within a minute.
      } else if (cleanupId) {
        // Explicitly deleted — just clear the event buffer
        deletedSessionIds.delete(cleanupId);
        clearSessionBuffer(cleanupId);
      }
      // Wait for all background start_* subscriptions to finish streaming
      // before closing the SSE stream — otherwise their progress events
      // arrive after the stream is closed and are silently dropped.
      await Promise.allSettled(backgroundTasks);
    }
  });
}

/** Stop (abort subprocess, keep session row) */
export async function PATCH(request: Request) {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(await request.json());
  sessionRunner.abort(sessionId);
  return Response.json({ ok: true });
}

/** Delete (abort subprocess and remove session row entirely) */
export async function DELETE(request: Request) {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(await request.json());
  deletedSessionIds.add(sessionId);
  sessionRunner.abort(sessionId);
  agentContextRegistry.delete(sessionId);
  deleteSession(sessionId);
  return Response.json({ ok: true });
}
