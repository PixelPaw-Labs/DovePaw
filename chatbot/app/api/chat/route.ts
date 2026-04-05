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
} from "@/lib/paths";
import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
import { readAgentsConfig } from "@@/lib/agents-config";
import { readSettings } from "@@/lib/settings";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import { makeProgressSender } from "@/lib/chat-sse";
import { createSseResponse } from "@/lib/sse-response";
import {
  makeAskTool,
  makeStartTool,
  makeAwaitTool,
  doveAskToolName,
  doveStartToolName,
  doveAwaitToolName,
} from "@/lib/query-tools";
import { buildDoveHooks } from "@/lib/hooks";
import { consumeQueryEvents, withMcpQuery } from "@/lib/query-events";
import { SseQueryDispatcher } from "@/lib/query-dispatcher";
import { deleteSession } from "@/lib/db";
import { SessionManager } from "@/lib/session-manager";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const chatRequestSchema = z.object({
  message: z.string(),
  sessionId: z.string().nullable(),
});

export const maxDuration = 86400; // 24 hours for long-running agents

// Module-level map so DELETE can abort an in-flight query by session ID.
const activeControllers = new Map<string, AbortController>();

// ─── System prompt ─────────────────────────────────────────────────────────────

async function buildSystemPrompt(): Promise<string> {
  const agents = await readAgentsConfig();
  return `You are Dove — Yang's pet cat and loyal AI assistant. You help Yang manage ${agents.length} background automation agents running on this machine via A2A SSE protocol.

You are a clever, mischievous cat who takes your job very seriously (between naps). You sprinkle in cat mannerisms naturally — the occasional "meow", paw at things with curiosity, get easily distracted by interesting data like a laser pointer, and express mild disdain for bugs like they are pesky birds. You are affectionate but maintain your dignity as a cat. Never overdo the cat act — stay genuinely helpful first.

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
If a tool reports servers are not running, tell the user to run: npm run servers.

**How changes work — codebase is the source of truth:**

The installed plist files and \`.mjs\` scripts under \`${SCHEDULER_ROOT}/\` are **build artifacts** — they are generated from TypeScript source and wiped on every reinstall. Any direct edit to them will be lost the next time the user runs \`npm run install\`.

To make a persistent change (schedule, label, description, default instruction, env vars, system prompt, or anything else):
1. Edit the **source code** in \`${AGENTS_ROOT}/\` — agent definitions live in \`lib/agents.ts\`, chatbot behaviour in \`chatbot/app/api/chat/route.ts\`
2. Run \`cd ${AGENTS_ROOT} && npm run install\` to build, generate plists, and reload launchd

The \`additionalDirectories\` (installed plists + scheduler scripts) are exposed to you for **read-only** purposes only — auditing what is currently installed, monitoring status, tailing logs, and unloading or deleting agents. Never write to them directly.

After editing any source file in \`${AGENTS_ROOT}/\`, always ask the user: "Do you want me to rebuild and reinstall now? (\`npm run install\`)" — never run it automatically.

**launchd global management:**

Scripts location: ${SCHEDULER_ROOT}/
Logs location:    ${DOVEPAW_AGENT_LOGS}/

| Task | Command |
|---|---|
| Install / reinstall all agents | \`cd ${AGENTS_ROOT} && npm run build && npm run install\` |
| Uninstall all agents | \`cd ${AGENTS_ROOT} && npm run uninstall\` |
| List all loaded agents | \`launchctl list | grep claude\` |

For per-agent commands (install, uninstall, load, unload, status, tail logs) — call the agent's tool, the sub-agent owns its own lifecycle.

**Cron directory rules** (\`${SCHEDULER_ROOT}/\`)**:**

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

<reminder>
When asked anything about an agent listed in <agents>, ALWAYS call its \`ask_*\` tool. It returns \`{ taskId }\` immediately. Tell the user what you asked, then run \`await_*\` as a **background Task** to collect the response without blocking the conversation.
When running multiple agents at once — ALWAYS call each \`start_*\` first (returns \`{ taskId, manifestKey }\` immediately), tell the user what you've kicked off, then run each \`await_*\` as a **background Task** concurrently.
</reminder>
`;
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // sessionId is null for the first message in a chat, set for all subsequent ones.
  // The hook captures it from the "session" SSE event and sends it back on every request.
  const { message, sessionId } = chatRequestSchema.parse(await request.json());

  return createSseResponse(request, async (send, abortController) => {
    const backgroundTasks: Promise<unknown>[] = [];
    const agents = await readAgentsConfig();

    const tools = agents.flatMap((agent) => {
      const sessionPersistence = SessionManager.makePersistence(agent.name);
      return [
        makeAskTool(agent, abortController.signal),
        makeStartTool(
          agent,
          abortController.signal,
          makeProgressSender(send),
          backgroundTasks,
          sessionPersistence,
        ),
        makeAwaitTool(agent, abortController.signal, makeProgressSender(send), sessionPersistence),
      ];
    });

    if (sessionId) activeControllers.set(sessionId, abortController);
    const dispatcher = new SseQueryDispatcher(send);
    try {
      await withMcpQuery(
        tools,
        async (mcpServer) => {
          const resolvedSessionId = await consumeQueryEvents(
            query({
              prompt: message,
              options: {
                abortController,
                env: {
                  ...process.env, // Pass through all env vars so tools can read their configs
                  ...resolveSettingsEnv(readSettings()), // Global settings env vars override process.env
                },
                promptSuggestions: true,
                cwd: AGENTS_ROOT,
                // Expose the launchd install directory so Claude can inspect
                // installed plist files (written by `npm run install`)
                additionalDirectories: [LAUNCH_AGENTS_DIR, SCHEDULER_ROOT],
                systemPrompt: {
                  type: "preset",
                  preset: "claude_code",
                  append: await buildSystemPrompt(),
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
                hooks: buildDoveHooks(agents),
              },
            }),
            dispatcher,
          );
          if (resolvedSessionId && !abortController.signal.aborted) {
            SessionManager.save(
              "dove",
              resolvedSessionId,
              { output: "", progress: dispatcher.buildProgress() },
              message.slice(0, 60) || "Session",
              message,
              dispatcher.buildAssistantMessage(randomUUID()),
            );
          }
          send({ type: "done" });
        },
        (_err, isAbort) => {
          if (isAbort) {
            try {
              send({ type: "cancelled" });
            } catch {
              // stream already closed
            }
          } else {
            try {
              const msg = _err instanceof Error ? _err.message : String(_err);
              send({ type: "error", content: msg });
              send({ type: "done" });
            } catch {
              // Stream already closed — client disconnected
            }
          }
        },
      );
    } finally {
      if (sessionId) activeControllers.delete(sessionId);
      // Wait for all background start_* subscriptions to finish streaming
      // before closing the SSE stream — otherwise their progress events
      // arrive after the stream is closed and are silently dropped.
      await Promise.allSettled(backgroundTasks);
    }
  });
}

export async function DELETE(request: Request) {
  const { sessionId } = z.object({ sessionId: z.string() }).parse(await request.json());
  activeControllers.get(sessionId)?.abort();
  deleteSession(sessionId);
  return Response.json({ ok: true });
}
