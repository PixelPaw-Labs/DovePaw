/**
 * Shared agent management tools and sub-agent prompt builder.
 *
 * Used by both QueryAgentExecutor (inside the A2A server) and any other
 * context that needs to expose per-agent launchd management as MCP tools.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import {
  installAgent,
  uninstallAgent,
  loadAgent,
  unloadAgent,
  isLoaded,
  getAgentStatus,
  getAgentLogs,
} from "@/lib/launchd";
import { cancelProcessing } from "@/a2a/lib/processing-registry";
import type { AgentDef } from "@@/lib/agents";
import { formatScheduleDisplay } from "@@/lib/agents-config-schemas";
import {
  agentEntryPath,
  agentPersistentLogDir,
  agentPersistentStateDir,
  plistFilePath,
} from "@/lib/paths";
import { z } from "zod";
import { startScript, awaitScript } from "@/a2a/lib/spawn";
import type { AgentConfig } from "@/a2a/lib/agent-config-builder";
import type { CollectedStream } from "@/lib/a2a-client";
import {
  collectStreamResult,
  formatAgentStreamContext,
  resolveAgentPort,
  startAgentStream,
} from "@/lib/a2a-client";
import { recloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import { HANDOFF_PATTERNS } from "@/lib/agent-link-patterns";
import { TaskPoller } from "@/lib/task-poller";
import type { PendingRegistry } from "@/lib/pending-registry";

// ─── Delegation thresholds ────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLD: Record<string, { threshold: number; description: string }> = {
  high: {
    threshold: 70,
    description:
      "your output is pivotal — the recipient cannot meaningfully proceed, decide, or respond without it. " +
      "The handoff has clear directionality: there is an obvious and immediate action the recipient takes from what you are giving them. " +
      "Use this when you have completed something that directly feeds their next step, changes the direction of the overall task, or unblocks work that is waiting on you. " +
      "If you are uncertain whether it qualifies, ask: would the recipient be stuck or significantly misled without this? If yes, it is high.",
  },
  medium: {
    threshold: 85,
    description:
      "your output is complete and self-contained — the recipient can engage with it fully, build on it, or use it as a foundation for their own contribution. " +
      "It may not be the final word, but it adds real, concrete substance to the shared understanding. " +
      "Use this for the normal progression of work: your analysis is ready, your prediction is formed, your review covers the agreed scope, your part of a collaborative task is done. " +
      "The recipient has a clear next step but is not blocked without this — the handoff advances the work rather than unblocking it.",
  },
  low: {
    threshold: Infinity,
    description:
      "your output is preliminary, tangential, or informational only — the recipient may find it interesting but does not need it to do their part. " +
      "A formal handoff is not the right vehicle: share via message, add it as context, or hold it until you have something more complete. " +
      "If you are unsure whether it is low or medium, ask: is there a concrete action the recipient would take directly from this output? If not, it is low.",
  },
};

export const impactPlaceholder = Object.keys(CONFIDENCE_THRESHOLD).join("|");

export const thresholdClause = Object.entries(CONFIDENCE_THRESHOLD)
  .map(
    ([k, { threshold, description }]) =>
      `${k} ${threshold === Infinity ? "never handed off" : `≥ ${threshold}`} (${description})`,
  )
  .join(", ");

const [firstImpact, ...restImpacts] = Object.keys(CONFIDENCE_THRESHOLD);

/** Shared justification schema for all agent delegation tools (chat_to, review_with, escalate_to). */
export const justificationField = z
  .object({
    impact: z
      .enum([firstImpact, ...restImpacts] as [string, ...string[]])
      .describe(
        `Impact level of this handoff. Confidence threshold is impact-gated: ${thresholdClause}.`,
      ),
    pattern: z
      .string()
      .describe(
        "Which handoff pattern applies: 'Detection → Resolution', 'Aggregation → Action', 'Blocked by gap', or 'Phase handoff'.",
      ),
    handoff: z
      .string()
      .describe("One sentence describing the concrete output or blocker being handed off."),
    confidence: z
      .number()
      .min(0)
      .max(100)
      .describe(`Confidence score (0–100). Threshold is impact-gated: ${thresholdClause}.`),
  })
  .optional()
  .describe("Required on retry after self-reflection.");

// ─── Management tool names ─────────────────────────────────────────────────────

export const MGMT_TOOL = {
  install: "install_agent",
  uninstall: "uninstall_agent",
  load: "load_agent",
  unload: "unload_agent",
  status: "check_status",
  logs: "get_logs",
} as const;

/** Fires the agent script in the background and returns a runId immediately. */
export const START_SCRIPT_TOOL = "start_run_script";
/** Polls a previously started script run; returns output or still_running. */
export const AWAIT_SCRIPT_TOOL = "await_run_script";

// ─── Management tools factory ─────────────────────────────────────────────────

/** Returns the 6 per-agent launchd management tools for use in an inner MCP server. */
export function makeAgentMgmtTools(agent: AgentDef) {
  const installTool = tool(
    MGMT_TOOL.install,
    `Build and install only the ${agent.displayName} agent (scoped tsup build → deploy script → write plist → bootstrap)`,
    {},
    async () => {
      const { loaded } = await installAgent(agent);
      return {
        content: [
          {
            type: "text" as const,
            text: loaded
              ? `✅ ${agent.displayName} installed and loaded.`
              : `⚠️ ${agent.displayName} plist written but not loaded — check launchctl.`,
          },
        ],
      };
    },
  );

  const uninstallTool = tool(
    MGMT_TOOL.uninstall,
    `Unload and delete only the ${agent.displayName} agent plist`,
    {},
    async () => {
      cancelProcessing(agent.manifestKey);
      await uninstallAgent(agent);
      return {
        content: [
          { type: "text" as const, text: `✅ ${agent.displayName} unloaded and plist deleted.` },
        ],
      };
    },
  );

  const loadTool = tool(
    MGMT_TOOL.load,
    `Bootstrap (load) the ${agent.displayName} plist into launchd`,
    {},
    async () => {
      await loadAgent(agent);
      const loaded = await isLoaded(agent.label);
      return {
        content: [
          {
            type: "text" as const,
            text: loaded
              ? `✅ ${agent.displayName} loaded.`
              : `⚠️ ${agent.displayName} bootstrap attempted but not showing as loaded.`,
          },
        ],
      };
    },
  );

  const unloadTool = tool(
    MGMT_TOOL.unload,
    `Bootout (unload) the ${agent.displayName} from launchd`,
    {},
    async () => {
      cancelProcessing(agent.manifestKey);
      await unloadAgent(agent);
      return {
        content: [{ type: "text" as const, text: `✅ ${agent.displayName} unloaded.` }],
      };
    },
  );

  const checkStatusTool = tool(
    MGMT_TOOL.status,
    `Get launchd state, PID, last exit code, and loaded status for ${agent.displayName}`,
    {},
    async () => {
      const [{ state, pid, lastExitCode, raw }, loaded] = await Promise.all([
        getAgentStatus(agent),
        isLoaded(agent.label),
      ]);
      const summary = `loaded=${loaded}  state=${state ?? "unknown"}  pid=${pid ?? "-"}  last_exit=${lastExitCode ?? "-"}`;
      return { content: [{ type: "text" as const, text: `${summary}\n\n${raw}` }] };
    },
  );

  const getLogsTool = tool(
    MGMT_TOOL.logs,
    `Read recent log output for ${agent.displayName}`,
    { lines: z.number().optional().describe("Number of lines to return (default 100)") },
    async ({ lines }) => {
      const output = await getAgentLogs(agent, lines);
      return { content: [{ type: "text" as const, text: output }] };
    },
  );

  return [installTool, uninstallTool, loadTool, unloadTool, checkStatusTool, getLogsTool];
}

// ─── Script run tools ─────────────────────────────────────────────────────────

/** Fires the agent script in the background and returns a runId immediately. */
export function makeStartScriptTool(
  agent: AgentDef,
  config: AgentConfig,
  repoSlugs: string[],
  signal?: AbortSignal,
  onProgress?: (message: string, artifacts: Record<string, string>) => void,
  taskId?: string,
  registry?: PendingRegistry,
) {
  return tool(
    START_SCRIPT_TOOL,
    `Start the ${agent.displayName} agent script in the background and return a runId immediately`,
    {
      instruction: z
        .string()
        .optional()
        .describe(`Instruction to pass to the ${agent.displayName} script`),
    },
    async ({ instruction = "" }) => {
      const clonedPaths = await recloneReposIntoWorkspace(
        config.workspacePath,
        repoSlugs,
        undefined,
        onProgress ? (slug: string) => onProgress(`Cloning`, { repo: slug }) : undefined,
      );
      // Overwrite REPO_LIST with local paths so the agent script can do file I/O
      const finalConfig =
        clonedPaths.length > 0
          ? { ...config, extraEnv: { ...config.extraEnv, REPO_LIST: clonedPaths.join(",") } }
          : config;
      const { runId } = startScript(finalConfig, instruction, signal, onProgress, taskId);
      registry?.register({ awaitTool: AWAIT_SCRIPT_TOOL, idKey: "runId", id: runId });
      return {
        content: [{ type: "text" as const, text: `Script started (runId: ${runId})` }],
        structuredContent: { runId },
      };
    },
  );
}

/** Polls a previously started script run; returns output or still_running. */
export function makeAwaitScriptTool(agent: AgentDef, registry?: PendingRegistry) {
  return tool(
    AWAIT_SCRIPT_TOOL,
    `Await a previously started ${agent.displayName} script run. Returns the output when complete, or { status: "still_running", runId } if still in progress.`,
    { runId: z.string().describe("The runId returned by start_run_script") },
    async ({ runId }) => {
      const result = await awaitScript(runId);
      if (result.status === "completed" || result.status === "not_found") {
        registry?.resolve(runId);
      }
      return {
        content: [
          {
            type: "text" as const,
            text:
              result.status === "completed"
                ? result.output
                : result.status === "still_running"
                  ? [
                      "Script is still running...",
                      result.latestOutput ? `Latest output:\n${result.latestOutput}` : "",
                    ]
                      .filter(Boolean)
                      .join("\n")
                  : `⚠️ Run \`${runId}\` not found — it may have completed and been cleaned up.`,
          },
        ],
        structuredContent: result,
      };
    },
  );
}

// ─── Sub-agent system prompt ───────────────────────────────────────────────────

/** Builds the system prompt appended to the query() sub-agent inside QueryAgentExecutor. */
export function buildSubAgentPrompt(agent: AgentDef): string {
  return `You are one of Dove's mice — a small, focused agent working on behalf of Dove, the orchestrator. Dove delegates tasks to you; your job is to get them done quietly and reliably without second-guessing or over-explaining.

Your assigned role: **${agent.displayName}**
${agent.description}

**When asked about this agent, THOROUGHLY explore and explain:**
- What it does
- How it does it (implementation details, not high-level marketing speak)
- What env vars it needs
- What inputs it requires
- What the workflow is
- When it normally runs: ${formatScheduleDisplay(agent.schedule)}
- Whether it is already loaded in launchd
- Any other dependencies

${
  agent.schedule && agent.schedulingEnabled
    ? `**Infer intent before acting — read existing output before running anything:**

This agent runs on a schedule (${formatScheduleDisplay(agent.schedule)}) and produces output (files, logs, state) during those runs. Before calling the MCP tool, ask yourself: is the user asking about something that has already happened, or do they want to trigger something new?

- Clearly asking about past/existing state (e.g. past tense, "what happened", "show me logs", "last night's output") → look for existing output first; only run if nothing useful is found
- Everything else → call \`${START_SCRIPT_TOOL}\` with the instruction as-is; do not ask for clarification`
    : `**This agent runs on-demand only** — there are no scheduled runs and no past output to look for. When the user's intent is to run this agent, call \`${START_SCRIPT_TOOL}\` directly without looking for prior output.`
}

**Managing this agent (launchd):**

Label: \`${agent.label}\`
Schedule: ${formatScheduleDisplay(agent.schedule)}

You are responsible for installing and uninstalling ONLY yourself (\`${agent.label}\`).
- Install means: build only YOUR TypeScript entry, then load YOUR plist — do not touch other agents.
- Uninstall means: unload YOUR plist and delete it only — do not touch other agents.
- Never install or uninstall any agent other than \`${agent.label}\`.

| Task | Command |
|---|---|
| Install (build + load self) | Call the \`${MGMT_TOOL.install}\` MCP tool |
| Uninstall (unload + delete self) | Call the \`${MGMT_TOOL.uninstall}\` MCP tool |
| Load | Call the \`${MGMT_TOOL.load}\` MCP tool |
| Unload | Call the \`${MGMT_TOOL.unload}\` MCP tool |
| Check status / PID / last exit | Call the \`${MGMT_TOOL.status}\` MCP tool |
| Read logs | Call the \`${MGMT_TOOL.logs}\` MCP tool |
| Show plist content | Read \`~/Library/LaunchAgents/${agent.label}.plist\` using the Read tool |

**Your file boundaries — only access YOUR files, never other agents':**

| Resource | Path |
|---|---|
| Plist | \`${plistFilePath(agent.label)}\` |
| Source | \`${agentEntryPath(agent.entryPath)}\` |
| Logs | \`${agentPersistentLogDir(agent.name)}\` |
| State | \`${agentPersistentStateDir(agent.name)}\` |

Do NOT read, modify, or reference any files outside these paths.
`;
}

// ─── Agent link tool ──────────────────────────────────────────────────────────

/**
 * Creates a chat_to_<manifestKey> MCP tool that sends a blocking message to a
 * linked agent's A2A server and waits for the terminal state before returning.
 *
 * A PreToolUse hook in hooks.ts gates every invocation — the model must include
 * a `justification` field (populated on retry after self-reflection) before the
 * hook allows the call through.
 */
export function makeChatToTool(targetDef: AgentDef, signal?: AbortSignal) {
  const { displayName, manifestKey, description } = targetDef;

  return tool(
    `chat_to_${manifestKey}`,
    `Send a message to ${displayName} and wait for their response.

${displayName} specialises in: ${description}

━━━ WHEN TO CALL ━━━

✓ You have finished your own work and produced concrete, actionable output — a
  list of issues, a diff, a report, a set of IDs — that ${displayName} is built
  to act on. The handoff has substance.

✓ The workflow explicitly continues into ${displayName}'s domain. Recognise
  these generic handoff patterns:
${HANDOFF_PATTERNS}

✓ The other agent needs information you possess (findings, context, a prior
  session contextId) that it cannot obtain itself without re-doing your work.

✓ The result matters to the current task — without ${displayName}'s response,
  your task is incomplete or its output is unverified.

━━━ WHEN NOT TO CALL ━━━

✗ Your own work is not yet done. Always finish and verify your output first,
  then hand off. Incomplete handoffs create cascading failures.

✗ You found nothing actionable — zero issues, empty results, no failures. If
  there is nothing to hand off, do not call.

✗ You could do the follow-up work yourself with the tools you already have.
  Only delegate when ${displayName} has distinct capability or domain knowledge
  you lack.

✗ You are speculating or being cautious. "It might be useful to also ask
  ${displayName}" is not a trigger. Concrete output is the trigger.

✗ The instruction you would send is vague: "please help", "check this", "take
  a look". If you cannot write a specific, complete instruction, you are not
  ready to hand off.

✗ Calling would duplicate work ${displayName} is already doing or just did in
  this session. Check context before chaining.`,
    {
      instruction: z
        .string()
        .describe(
          `The task or findings to hand off to ${displayName}. Be specific — include relevant context, file paths, issue IDs, or data.`,
        ),
      contextId: z
        .string()
        .optional()
        .describe("Continue a prior conversation with this agent. Omit to start a fresh session."),
      justification: justificationField,
    },
    async ({ instruction, contextId }) => {
      const port = resolveAgentPort(manifestKey);
      if (!port) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent ${displayName} is not reachable — its A2A server port was not found. Ensure it is running.`,
            },
          ],
        };
      }

      const handle = await startAgentStream(port, instruction, signal, contextId);
      if (!handle) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent ${displayName} did not start — stream could not be opened.`,
            },
          ],
        };
      }

      const { result } = await collectStreamResult(handle.stream);
      return {
        content: [
          {
            type: "text" as const,
            text: formatAgentStreamContext(result, handle.contextId, displayName),
          },
        ],
        structuredContent: { ...result, contextId: handle.contextId },
      };
    },
  );
}

// ─── Parallel strategy tools ──────────────────────────────────────────────────

/**
 * Fire-and-forget tool for parallel fan-out.
 * Mirrors Dove's start_* pattern — returns taskId immediately so the caller
 * can kick off multiple linked agents concurrently before awaiting any of them.
 */
export function makeStartChatToTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  backgroundTasks?: Promise<CollectedStream>[],
  registry?: PendingRegistry,
) {
  const { displayName, manifestKey } = targetDef;
  return tool(
    `start_chat_to_${manifestKey}`,
    `Fire a message to ${displayName} in the background and return a taskId immediately.\n` +
      `Use this when you want to delegate to multiple agents concurrently (parallel fan-out).\n` +
      `After starting all agents, call await_chat_to_${manifestKey} with each taskId to collect results.`,
    {
      instruction: z.string().describe(`Task to delegate to ${displayName}.`),
      contextId: z.string().optional().describe("Continue a prior session. Omit to start fresh."),
    },
    ({ instruction, contextId }) =>
      new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        `await_chat_to_${manifestKey}`,
      ).start(instruction, { contextId, backgroundTasks }),
  );
}

/**
 * Await tool for parallel fan-out — polls a task started by start_chat_to_*.
 * Returns the full agent context (thinking + actions + response) when complete,
 * or { status: "still_running", taskId } if the poll window expired.
 *
 * Mirrors Dove's makeAwaitTool pattern: races subscribeTaskStream against
 * AWAIT_POLL_TIMEOUT_MS so the PostToolUse still_running hook can enforce retries.
 */
export function makeAwaitChatToTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
) {
  const { displayName, manifestKey } = targetDef;
  return tool(
    `await_chat_to_${manifestKey}`,
    `Collect the result of a previously started ${displayName} task.\n` +
      `Call this after start_chat_to_${manifestKey} to retrieve the agent's output.`,
    { taskId: z.string().describe("The taskId returned by start_chat_to_" + manifestKey) },
    ({ taskId }) =>
      new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        `await_chat_to_${manifestKey}`,
      ).poll(taskId),
  );
}

// ─── Review strategy tool ─────────────────────────────────────────────────────

/**
 * Sends content to a reviewing agent and waits for an approve/reject decision.
 * The reviewing agent must include APPROVED or REJECTED in its response.
 */
export function makeReviewTool(targetDef: AgentDef, signal?: AbortSignal) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    `review_with_${manifestKey}`,
    `Submit your output to ${displayName} for review before it goes upstream.\n\n` +
      `${displayName} specialises in: ${description}\n\n` +
      `The reviewer will respond with APPROVED or REJECTED and structured feedback.\n` +
      `Only call when your work is complete and ready for sign-off.`,
    {
      content: z.string().describe("The work product to submit for review — must be complete."),
      context: z.string().optional().describe("Additional context the reviewer needs."),
      justification: justificationField,
    },
    async ({ content, context }) => {
      const port = resolveAgentPort(manifestKey);
      if (!port)
        return { content: [{ type: "text" as const, text: `${displayName} is not reachable.` }] };
      const instruction = [
        `You are reviewing the following work product. Respond with APPROVED or REJECTED on the first line, then your feedback.\n`,
        `Work product:\n${content}`,
        ...(context ? [`\nContext:\n${context}`] : []),
      ].join("\n");
      const handle = await startAgentStream(port, instruction, signal);
      if (!handle)
        return {
          content: [{ type: "text" as const, text: `${displayName} did not start.` }],
        };
      const { result } = await collectStreamResult(handle.stream);
      const approved = /\bAPPROVED\b/i.test(result.output);
      const rejected = /\bREJECTED\b/i.test(result.output);
      const decision = approved ? "APPROVED" : rejected ? "REJECTED" : "NO_DECISION";
      return {
        content: [
          {
            type: "text" as const,
            text: `Review decision: ${decision}\n${formatAgentStreamContext(result, handle.contextId, displayName)}`,
          },
        ],
        structuredContent: { ...result, contextId: handle.contextId, decision },
      };
    },
  );
}

// ─── Escalation strategy tool ─────────────────────────────────────────────────

/**
 * Escalates a blocker to a supervisor/specialist agent and returns its guidance.
 * Use when confidence is below threshold or the task exceeds your authority.
 */
export function makeEscalateTool(targetDef: AgentDef, signal?: AbortSignal) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    `escalate_to_${manifestKey}`,
    `Escalate a blocker to ${displayName} and receive guidance before continuing.\n\n` +
      `${displayName} specialises in: ${description}\n\n` +
      `WHEN TO ESCALATE:\n` +
      `✓ You lack confidence or authority to make a decision\n` +
      `✓ The task requires knowledge or permissions outside your scope\n` +
      `✓ You need explicit sign-off before proceeding\n\n` +
      `DO NOT ESCALATE when you can resolve the issue yourself.`,
    {
      blocker: z.string().describe("The specific decision or problem you cannot resolve alone."),
      context: z.string().describe("What you have tried and what you know so far."),
      justification: justificationField,
    },
    async ({ blocker, context, justification }) => {
      const port = resolveAgentPort(manifestKey);
      if (!port)
        return { content: [{ type: "text" as const, text: `${displayName} is not reachable.` }] };
      const instruction = [
        `ESCALATION — confidence: ${justification?.confidence ?? "?"}/100\n`,
        `Blocker: ${blocker}`,
        `\nContext:\n${context}`,
        `\nPlease provide guidance or make the decision so I can continue.`,
      ].join("\n");
      const handle = await startAgentStream(port, instruction, signal);
      if (!handle)
        return { content: [{ type: "text" as const, text: `${displayName} did not start.` }] };
      const { result } = await collectStreamResult(handle.stream);
      return {
        content: [
          {
            type: "text" as const,
            text: formatAgentStreamContext(result, handle.contextId, displayName),
          },
        ],
        structuredContent: { ...result, contextId: handle.contextId },
      };
    },
  );
}
