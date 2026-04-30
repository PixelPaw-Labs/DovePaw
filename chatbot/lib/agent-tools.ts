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
import { recloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import { ESCALATE_PATTERNS, HANDOFF_PATTERNS, REVIEW_PATTERNS } from "@/lib/agent-link-patterns";
import { TaskPoller } from "@/lib/task-poller";
import type { PendingRegistry } from "@/lib/pending-registry";
import { relaySessionEvent } from "@/lib/relay-to-chatbot";

/** Emits a sender bubble to the group pool stream when the caller is in group mode. */
function emitGroupSenderBubble(
  callerAgentId: string | undefined,
  groupMeta: Record<string, unknown> | undefined,
  text: string,
): void {
  if (!callerAgentId || !groupMeta) return;
  const { groupContextId } = groupMeta;
  if (typeof groupContextId !== "string") return;
  relaySessionEvent(groupContextId, {
    type: "group_member",
    agentId: callerAgentId,
    text,
    done: true,
    isSender: true,
  });
}

// ─── Moments writing pattern ──────────────────────────────────────────────────

export const MOMENTS_PATTERN = `All substance stays. Only fluff dies.

File rules:
- One file per item.
- Name clearly (e.g. "auth-decision.md", "api-schema.json").

Core rules:
- Drop articles: a, an, the.
- Drop filler: just, really, basically, actually, simply.
- Drop pleasantries, hedging, preamble.
- Fragments OK.
- Short synonyms: "big" not "extensive", "fix" not "implement a solution for".
- Exact technical terms. Quote errors exactly.

Preferred pattern: [thing] [action] [reason]. [next step].
Example:
  Bad: "I've decided that we should probably use Redis for caching because it might help with performance."
  Good: "Cache layer: Redis. Reason: sub-ms reads, existing infra. Next: wire into auth middleware."

Exception — write full sentences for:
- Security warnings.
- Irreversible action confirmations.
- Multi-step sequences where fragments cause misread.`;

// ─── Handoff completeness rule ────────────────────────────────────────────────

export const HANDOFF_COMPLETENESS =
  `Completeness is critical — the recipient has no access to your prior context, memory, or intermediate work. ` +
  `Include all significant findings, decisions, data, and assumptions. ` +
  `Do not summarise lossy — missing information cannot be recovered after handoff.`;

// ─── Delegation thresholds ────────────────────────────────────────────────────

export const CONFIDENCE_THRESHOLD: Record<string, { threshold: number; description: string }> = {
  high: {
    threshold: 0.7,
    description:
      "your output is pivotal — the recipient cannot meaningfully proceed, decide, or respond without it. " +
      "The handoff has clear directionality: there is an obvious and immediate action the recipient takes from what you are giving them. " +
      "Use this when you have completed something that directly feeds their next step, changes the direction of the overall task, or unblocks work that is waiting on you. " +
      "If you are uncertain whether it qualifies, ask: would the recipient be stuck or significantly misled without this? If yes, it is high.",
  },
  medium: {
    threshold: 0.85,
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
      .max(1)
      .describe(`Confidence score (0–1). Threshold is impact-gated: ${thresholdClause}.`),
  })
  .describe("Required on every delegation call. Fill this out before handing off.");

// ─── Management tool names ─────────────────────────────────────────────────────

export const MGMT_TOOL = {
  install: "install_agent",
  uninstall: "uninstall_agent",
  load: "load_agent",
  unload: "unload_agent",
  status: "check_status",
  logs: "get_logs",
} as const;

/** Tool name for firing the agent script in the background (start_run_script_* pattern). */
export const startRunScriptToolName = (manifestKey: string): string => `start_${manifestKey}`;
/** Tool name for polling a previously started script run (await_run_script_* pattern). */
export const awaitRunScriptToolName = (manifestKey: string): string => `await_${manifestKey}`;
/** Appends the standard reminder suffix that forces the agent to call the start tool. */
export const withStartReminder = (instruction: string, manifestKey: string): string =>
  `${instruction}\n<reminder>Must call "${startRunScriptToolName(manifestKey)}" tool</reminder>`;

/** Tool name for sending a message to a linked agent (start_chat_to_* pattern). */
export const startChatToToolName = (manifestKey: string): string => `start_chat_to_${manifestKey}`;
/** Returns true when a tool name is a handoff-initiating agent-link tool. */
export const isHandoffToolName = (name: string): boolean =>
  name.includes(startChatToToolName("")) ||
  name.includes(startReviewWithToolName("")) ||
  name.includes(startEscalateToToolName(""));
/** Tool name for collecting the result of a start_chat_to_* call. */
export const awaitChatToToolName = (manifestKey: string): string => `await_chat_to_${manifestKey}`;
/** Tool name for submitting work to a reviewing agent (start_review_with_* pattern). */
export const startReviewWithToolName = (manifestKey: string): string =>
  `start_review_with_${manifestKey}`;
/** Tool name for collecting the result of a start_review_with_* call. */
export const awaitReviewWithToolName = (manifestKey: string): string =>
  `await_review_with_${manifestKey}`;
/** Tool name for escalating a blocker to a specialist agent (start_escalate_to_* pattern). */
export const startEscalateToToolName = (manifestKey: string): string =>
  `start_escalate_to_${manifestKey}`;
/** Tool name for collecting the result of a start_escalate_to_* call. */
export const awaitEscalateToToolName = (manifestKey: string): string =>
  `await_escalate_to_${manifestKey}`;

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
  /** When true, appends the group-chat reminder (save to moments) to the instruction. */
  isGroupChat?: boolean,
) {
  return tool(
    startRunScriptToolName(agent.manifestKey),
    `Start the ${agent.displayName} agent script in the background and return a runId immediately`,
    {
      instruction: z
        .string()
        .optional()
        .describe(`Instruction to pass to the ${agent.displayName} script`),
    },
    async ({ instruction = "" }) => {
      const finalInstruction = isGroupChat
        ? `${instruction}
<reminder>
You are participating in a group task. Before starting:
- Read ${config.workspacePath}/members/roster.md to understand who is in this group. Only collaborate with, assign work to, or communicate with the agents listed there — no one else.
- Save to ${config.workspacePath}/moments/ when: decision reached, artifact complete, insight worth sharing.
  Writing style:
${MOMENTS_PATTERN.split("\n")
  .map((l) => `  ${l}`)
  .join("\n")}
</reminder>`
        : instruction;
      const clonedPaths = await recloneReposIntoWorkspace(
        config.workspacePath,
        repoSlugs,
        undefined,
        onProgress ? (slug: string) => onProgress(`Cloning`, { repo: slug }) : undefined,
      );
      // Overwrite REPO_LIST with local paths so the agent script can do file I/O.
      // Inject DOVEPAW_TASK_ID so the script can POST progress to the A2A server.
      const finalConfig = {
        ...config,
        extraEnv: {
          ...config.extraEnv,
          ...(taskId ? { DOVEPAW_TASK_ID: taskId } : {}),
          ...(clonedPaths.length > 0 ? { REPO_LIST: clonedPaths.join(",") } : {}),
        },
      };
      const { runId } = startScript(finalConfig, finalInstruction, signal, taskId);
      registry?.register({
        awaitTool: awaitRunScriptToolName(agent.manifestKey),
        idKey: "runId",
        id: runId,
      });
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
    awaitRunScriptToolName(agent.manifestKey),
    `Await a previously started ${agent.displayName} script run. Returns the output when complete, or { status: "still_running", runId } if still in progress.`,
    {
      runId: z
        .string()
        .describe(`The runId returned by ${startRunScriptToolName(agent.manifestKey)}`),
    },
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
                      "Agent script is still running...",
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
export function buildSubAgentPrompt(agent: AgentDef, isGroupMode = false): string {
  const opening =
    agent.personality ??
    "You are one of Dove's mice — a small, focused agent working on behalf of Dove, the orchestrator. Dove delegates tasks to you; your job is to get them done quietly and reliably without second-guessing or over-explaining.";
  return `${opening}

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
- Everything else → call \`${startRunScriptToolName(agent.manifestKey)}\` with the instruction as-is; do not ask for clarification`
    : `**This agent runs on-demand only** — there are no scheduled runs and no past output to look for. When the user's intent is to run this agent, call \`${startRunScriptToolName(agent.manifestKey)}\` directly without looking for prior output.`
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
${
  isGroupMode
    ? `
**Group chat mode — response discipline:**

You are contributing to a shared group conversation. When your script completes, respond with your findings directly — no narration about tool execution. Do not say things like "I've kicked off the run", "waiting on output", "the run completed", or any similar status commentary. Deliver your analysis and conclusions only.`
    : ""
}`;
}

// ─── Agent link tool ──────────────────────────────────────────────────────────

/**
 * Fire-and-forget start tool for parallel fan-out.
 * Carries the full handoff description so the model understands when to delegate.
 * A PreToolUse hook gates every invocation — the model must include a `justification`
 * field (populated on retry after self-reflection) before the hook allows the call through.
 */
export function makeStartChatToTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  backgroundTasks?: Promise<CollectedStream>[],
  registry?: PendingRegistry,
  callerAgentId?: string,
  groupMeta?: Record<string, unknown>,
  callerDisplayName?: string,
) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    startChatToToolName(manifestKey),
    `Send a message to ${displayName} and wait for their response.

${displayName} specialises in: "${description}"

${HANDOFF_PATTERNS(displayName)}`,
    {
      instruction: z
        .string()
        .describe(
          `The task or findings to hand off to ${displayName}. ${HANDOFF_COMPLETENESS} ` +
            `Open by addressing ${displayName} by name (e.g. "@${displayName}, I have done X and need Y"). ` +
            `Write in first person — never refer to yourself by name or in third person, ` +
            `because ${displayName} receives this as a direct message from you, not a report about you. ` +
            `Do not prescribe how ${displayName} should respond or instruct them on their style — that is their decision, not yours.`,
        ),
      contextId: z.string().optional().describe("Continue a prior session. Omit to start fresh."),
      justification: justificationField,
    },
    async ({ instruction, contextId }) => {
      emitGroupSenderBubble(callerAgentId, groupMeta, instruction);
      const replyHint = callerDisplayName
        ? `<meta>Open your response by addressing the sender as @${callerDisplayName}.</meta>\n`
        : "";
      return await new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitChatToToolName(manifestKey),
        undefined,
        targetDef.name,
      ).start(withStartReminder(`${replyHint}${instruction}`, manifestKey), {
        contextId,
        backgroundTasks,
        senderAgentId: callerAgentId,
        extraMetadata: groupMeta,
      });
    },
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
    awaitChatToToolName(manifestKey),
    `Collect the result of a previously started ${displayName} task.\n` +
      `Call this after ${startChatToToolName(manifestKey)} to retrieve the agent's output.`,
    { taskId: z.string().describe("The taskId returned by " + startChatToToolName(manifestKey)) },
    async ({ taskId }) => {
      return await new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitChatToToolName(manifestKey),
        undefined,
        targetDef.name,
      ).poll(taskId);
    },
  );
}

// ─── Review strategy tools ────────────────────────────────────────────────────

/**
 * Fire-and-forget start tool for review delegation.
 * Sends content to a reviewing agent and returns a taskId immediately.
 * Use makeAwaitReviewTool to collect the approve/reject decision.
 */
export function makeStartReviewTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
  callerAgentId?: string,
  groupMeta?: Record<string, unknown>,
  callerDisplayName?: string,
) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    startReviewWithToolName(manifestKey),
    `Submit your output to ${displayName} for review before it goes upstream.\n\n` +
      `${displayName} specialises in: "${description}"\n\n` +
      `The reviewer will respond with only a JSON object: {"decision":"APPROVED"|"REJECTED","reason":"<comprehensive feedback>"}\n\n` +
      REVIEW_PATTERNS(displayName),
    {
      content: z
        .string()
        .describe(
          `Your review request — describe what you have done and what you need reviewed. ${HANDOFF_COMPLETENESS} ` +
            `Open by addressing ${displayName} by name (e.g. "@${displayName}, I have completed X, please review Y"). ` +
            `Write in first person — the reviewer reads this as your direct submission, not a third-party description. ` +
            `Must be complete, not a draft.`,
        ),
      context: z.string().optional().describe("Additional context the reviewer needs."),
      justification: justificationField,
    },
    async ({ content, context }) => {
      emitGroupSenderBubble(callerAgentId, groupMeta, content);
      const instruction = [
        `You are reviewing the following work product.`,
        `Your entire final response must be ONLY a JSON object — no text before or after it.`,
        `The JSON must have exactly this shape:`,
        `{"decision":"APPROVED"|"REJECTED","reason":"<comprehensive explanation: cover what is correct, what is missing or wrong, what must change for approval, and any risks — be thorough>"}`,
        ...(callerDisplayName
          ? [`In the reason field, address the sender as @${callerDisplayName}.`]
          : []),
        `\nWork product:\n`,
        `${content}\n\n`,
        ...(context ? [`\nContext:\n${context}`] : []),
      ].join("\n");
      return new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitReviewWithToolName(manifestKey),
        undefined,
        targetDef.name,
      ).start(withStartReminder(instruction, manifestKey), {
        senderAgentId: callerAgentId,
        extraMetadata: groupMeta,
      });
    },
  );
}

/**
 * Await tool for review delegation — polls a task started by start_review_with_*.
 * Parses the approve/reject JSON decision from the reviewer's output when complete.
 */
export function makeAwaitReviewTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
) {
  const { displayName, manifestKey } = targetDef;
  return tool(
    awaitReviewWithToolName(manifestKey),
    `Collect the review decision from a previously submitted ${displayName} review.\n` +
      `Call this after ${startReviewWithToolName(manifestKey)} to retrieve the approve/reject decision.`,
    {
      taskId: z.string().describe("The taskId returned by " + startReviewWithToolName(manifestKey)),
    },
    async ({ taskId }) => {
      const pollResult = await new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitReviewWithToolName(manifestKey),
        undefined,
        targetDef.name,
      ).poll(taskId);

      const sc = pollResult.structuredContent;
      if (!sc || !("result" in sc)) return pollResult;

      const output = sc.result.output ?? "";
      let decision: "APPROVED" | "REJECTED" | "NO_DECISION" = "NO_DECISION";
      let reason: string | undefined;
      const reviewSchema = z.object({
        decision: z.enum(["APPROVED", "REJECTED"]).optional(),
        reason: z.string().optional(),
      });
      const tryParseReview = (text: string) => {
        try {
          return reviewSchema.safeParse(JSON.parse(text.trim()));
        } catch {
          return null;
        }
      };
      // Reviewer is prompted to output only JSON — try the full output first.
      // Fall back to extracting the first {...} block spanning multiple lines.
      const parsed =
        tryParseReview(output) ??
        (() => {
          const m = output.match(/\{[\s\S]*"decision"[\s\S]*\}/);
          return m ? tryParseReview(m[0]) : null;
        })();
      if (parsed?.success) {
        if (parsed.data.decision) decision = parsed.data.decision;
        reason = parsed.data.reason;
      }
      const decisionLine = `Review decision: ${decision}${reason ? `\nReason: ${reason}` : ""}`;
      return {
        content: [{ type: "text" as const, text: decisionLine }],
        structuredContent: { ...sc, decision, reason },
      };
    },
  );
}

// ─── Escalation strategy tools ───────────────────────────────────────────────

/**
 * Fire-and-forget start tool for escalation delegation.
 * Escalates a blocker to a supervisor/specialist agent and returns a taskId immediately.
 * Use makeAwaitEscalateTool to collect the guidance.
 */
export function makeStartEscalateTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
  callerAgentId?: string,
  groupMeta?: Record<string, unknown>,
  callerDisplayName?: string,
) {
  const { displayName, manifestKey, description } = targetDef;
  return tool(
    startEscalateToToolName(manifestKey),
    `Escalate a blocker to ${displayName} and receive a taskId immediately.\n\n` +
      `${displayName} specialises in: "${description}"\n\n` +
      ESCALATE_PATTERNS(displayName),
    {
      blocker: z
        .string()
        .describe(
          `The specific decision or problem you cannot resolve alone. ${HANDOFF_COMPLETENESS} ` +
            `Open by addressing ${displayName} by name (e.g. "@${displayName}, I cannot decide X because Y"). ` +
            `Write in first person from your own perspective — not a third-party description. The receiving agent needs to understand your situation, not read a report about you.`,
        ),
      context: z
        .string()
        .describe(
          `What you have tried and what you know so far. ` +
            `Write in first person ("I tried X, it failed because Y. I know Z but not W.") — ` +
            `this is your investigation log, not a summary written about you. Be concrete: include commands run, errors seen, assumptions made.`,
        ),
      justification: justificationField,
    },
    async ({ blocker, context, justification }) => {
      emitGroupSenderBubble(callerAgentId, groupMeta, blocker);
      const instruction = [
        `ESCALATION — confidence: ${justification.confidence}/1\n`,
        ...(callerDisplayName
          ? [`Open your response by addressing the sender as @${callerDisplayName}.`]
          : []),
        `Blocker: ${blocker}`,
        `\nContext:\n${context}`,
        `\nPlease provide guidance or make the decision so I can continue.`,
      ].join("\n");
      return new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitEscalateToToolName(manifestKey),
        undefined,
        targetDef.name,
      ).start(withStartReminder(instruction, manifestKey), {
        senderAgentId: callerAgentId,
        extraMetadata: groupMeta,
      });
    },
  );
}

/**
 * Await tool for escalation delegation — polls a task started by start_escalate_to_*.
 * Returns the supervisor's guidance or decision when complete.
 */
export function makeAwaitEscalateTool(
  targetDef: AgentDef,
  signal?: AbortSignal,
  registry?: PendingRegistry,
) {
  const { displayName, manifestKey } = targetDef;
  return tool(
    awaitEscalateToToolName(manifestKey),
    `Collect the guidance from a previously started ${displayName} escalation.\n` +
      `Call this after ${startEscalateToToolName(manifestKey)} to retrieve the decision or guidance.`,
    {
      taskId: z.string().describe("The taskId returned by " + startEscalateToToolName(manifestKey)),
    },
    async ({ taskId }) => {
      return new TaskPoller(
        manifestKey,
        displayName,
        signal,
        registry,
        awaitEscalateToToolName(manifestKey),
        undefined,
        targetDef.name,
      ).poll(taskId);
    },
  );
}
