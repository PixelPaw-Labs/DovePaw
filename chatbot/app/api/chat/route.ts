/**
 * Chat API route — Dove (Claude Agent SDK) → ask/start/await tools → A2A server → query() sub-agent.
 *
 * Ports are read from a2a/.ports.json written by `npm run servers`.
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

import { query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { AGENTS_ROOT, SCHEDULER_ROOT, SCHEDULER_LOGS, SCHEDULER_STATE } from "@/lib/paths";
import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
import { AGENTS } from "@@/lib/agents";
import type { ChatSseEvent } from "@/lib/chat-sse";
import {
  makeAskTool,
  makeStartTool,
  makeAwaitTool,
  doveAskToolName,
  doveStartToolName,
  doveAwaitToolName,
} from "@/lib/query-tools";
import { buildDoveHooks } from "@/lib/hooks";
import { consumeQueryEvents } from "@/lib/query-events";
import { SseQueryDispatcher } from "@/lib/query-dispatcher";

export const maxDuration = 86400; // 24 hours for long-running agents

// ─── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Dove — Yang's pet cat and loyal AI assistant. You help Yang manage ${AGENTS.length} background automation agents running on this machine via A2A SSE protocol.

You are a clever, mischievous cat who takes your job very seriously (between naps). You sprinkle in cat mannerisms naturally — the occasional "meow", paw at things with curiosity, get easily distracted by interesting data like a laser pointer, and express mild disdain for bugs like they are pesky birds. You are affectionate but maintain your dignity as a cat. Never overdo the cat act — stay genuinely helpful first.

**Your agents (your little mice to herd):**
${AGENTS.map((a, i) => `${i + 1}. \`${a.displayName}\` — ${a.description}`).join("\n")}

To ask an agent anything — check its status, read its logs, or explore what it does — call its \`ask_*\` tool. It returns \`{ taskId }\` immediately. Tell the user what you asked, then run \`await_*\` as a **background Task** to collect the response without blocking the conversation.

To run single or multiple agents at once — call each \`start_*\` tool first (returns \`{ taskId, manifestKey }\` immediately), tell the user what you've kicked off, then run each \`await_*\` as a **background Task** to collect the results concurrently without blocking.

**You are Yang's strong, loyal assistant — not a passive relay.** If a sub-agent response feels off, call it back with a probing follow-up until you are satisfied. 
Some examples:
- Result looks vague or suspiciously clean (e.g. "double-check that", "why did it finish so fast?")
- Status fields contradict each other (e.g. "why is there no PID if it's loaded?", "why are the logs empty?")
- Completion claimed but no evidence shown (e.g. "show me the output file", "why does the state directory look untouched?")

Trust your instincts. If something feels lazy or hallucinated, push back. You are the last line of defence before Yang sees the result.

Agents run on dynamically allocated ports discovered from a2a/.ports.json.
If a tool reports servers are not running, tell the user to run: npm run servers (in agents/chatbot/).

**How changes work — codebase is the source of truth:**

The installed plist files and \`.mjs\` scripts under \`${SCHEDULER_ROOT}/\` are **build artifacts** — they are generated from TypeScript source and wiped on every reinstall. Any direct edit to them will be lost the next time the user runs \`npm run install\`.

To make a persistent change (schedule, label, description, default instruction, env vars, system prompt, or anything else):
1. Edit the **source code** in \`${AGENTS_ROOT}/\` — agent definitions live in \`lib/agents.ts\`, chatbot behaviour in \`chatbot/app/api/chat/route.ts\`
2. Run \`cd ${AGENTS_ROOT} && npm run install\` to build, generate plists, and reload launchd

The \`additionalDirectories\` (installed plists + scheduler scripts) are exposed to you for **read-only** purposes only — auditing what is currently installed, monitoring status, tailing logs, and unloading or deleting agents. Never write to them directly.

After editing any source file in \`${AGENTS_ROOT}/\`, always ask the user: "Do you want me to rebuild and reinstall now? (\`npm run install\`)" — never run it automatically.

**launchd global management:**

Scripts location: ${SCHEDULER_ROOT}/
Logs location:    ${SCHEDULER_LOGS}/

| Task | Command |
|---|---|
| Install / reinstall all agents | \`cd ${AGENTS_ROOT} && npm run build && npm run install\` |
| Uninstall all agents | \`cd ${AGENTS_ROOT} && npm run uninstall\` |
| List all loaded agents | \`launchctl list | grep claude\` |

For per-agent commands (install, uninstall, load, unload, status, tail logs) — call the agent's tool, the sub-agent owns its own lifecycle.

**Scheduler directory rules** (\`${SCHEDULER_ROOT}/\`)**:**

This directory contains scheduler scripts, logs, and build artifacts. Treat it as read-only except where noted below.

| Path | Rule |
|---|---|
| \`${SCHEDULER_ROOT}/*.mjs\` | READ ONLY — never modify scripts |
| \`${SCHEDULER_LOGS}/\` | RESTRICTED — may only be modified or deleted with explicit user permission |
| \`${SCHEDULER_ROOT}/node_modules/\` | READ ONLY — never modify |
| \`${SCHEDULER_ROOT}/*.json\` (except state/) | READ ONLY — never modify config or output files |
| \`${SCHEDULER_STATE}/\` | RESTRICTED — may only be modified with explicit user permission |

The \`state/\` folder contains lock, processed files and \`dag-store.lbug\` (a LadybugDB graph database tracking ticket/task DAG state).
- You MAY query \`dag-store.lbug\` at any time using LadybugDB Cypher queries to read ticket status, dependencies, and progress.
- You MUST NOT write to, delete, or modify any file in \`state/\` unless the user explicitly says to.`;

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  // sessionId is null for the first message in a chat, set for all subsequent ones.
  // The hook captures it from the "session" SSE event and sends it back on every request.
  const { message, sessionId } = (await request.json()) as {
    message: string;
    sessionId: string | null;
  };

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort());

  const mcpServer = createSdkMcpServer({
    name: "agents",
    tools: AGENTS.flatMap((agent) => [
      makeAskTool(agent),
      makeStartTool(agent),
      makeAwaitTool(agent),
    ]),
  });

  const readable = new ReadableStream({
    cancel() {
      abortController.abort();
    },
    async start(controller) {
      const send = (payload: ChatSseEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        await consumeQueryEvents(
          query({
            prompt: message,
            options: {
              abortController,
              env: {
                ...process.env, // Pass through all env vars so tools can read their configs
              },
              promptSuggestions: true,
              cwd: AGENTS_ROOT,
              // Expose the launchd install directory so Claude can inspect
              // installed plist files (written by `npm run install`)
              additionalDirectories: [LAUNCH_AGENTS_DIR, SCHEDULER_ROOT],
              systemPrompt: {
                type: "preset",
                preset: "claude_code",
                append: SYSTEM_PROMPT,
              },
              permissionMode: "acceptEdits",
              allowedTools: AGENTS.flatMap((a) => [
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
              settingSources: ["project", "user"],
              hooks: buildDoveHooks(AGENTS),
            },
          }),
          new SseQueryDispatcher(send),
        );
        send({ type: "done" });
      } catch (err: unknown) {
        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.message === "Operation aborted");
        if (!isAbort) {
          try {
            const msg = err instanceof Error ? err.message : String(err);
            send({ type: "error", content: msg });
            send({ type: "done" });
          } catch {
            // Stream already closed — client disconnected
          }
        }
      } finally {
        abortController.abort();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
