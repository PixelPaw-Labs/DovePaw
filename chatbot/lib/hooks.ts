/**
 * Shared query() hook configuration.
 *
 * buildAgentHooks — generic factory, usable by any query() caller
 * buildDoveHooks  — convenience wrapper for Dove's top-level query (route.ts)
 *
 * Sub-agent hooks live in subagent-hooks.ts.
 */

import { randomUUID } from "crypto";
import { realpath } from "node:fs/promises";
import path from "path";
import type {
  UserPromptSubmitHookSpecificOutput,
  PreToolUseHookSpecificOutput,
  PostToolUseHookSpecificOutput,
  HookCallbackMatcher,
  HookEvent,
  CanUseTool,
} from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { bashHasWriteOperation } from "@@/lib/security-policy";
import {
  DOVE_RESPONSE_REMINDER,
  GROUP_ORCHESTRATOR_REMINDER,
  buildDoveLeanReminder,
  buildDovePromptReminder,
} from "@@/lib/dove-lean-reminder";
import { readAgentLinks, resolveLinkedTargets } from "@@/lib/agent-links";
import { AGENTS_ROOT } from "@@/lib/paths";
import { doveAwaitToolName, doveStartToolName, CONFIDENCE_THRESHOLD } from "@/lib/query-tools";
import { PendingRegistry, type PendingEntry } from "@/lib/pending-registry";
import type { ChatSseEvent } from "@/lib/chat-sse";
import { addPendingPermission, abortPendingPermissions } from "@/lib/pending-permissions";
import { addPendingQuestion, abortPendingQuestions } from "@/lib/pending-questions";
import type { Question } from "@/lib/chat-sse";

// ─── MCP tool response parsing ───────────────────────────────────────────────

/**
 * Extracts the structured content from a PostToolUse `tool_response`.
 *
 * The SDK serialises MCP tool `structuredContent` as a JSON string when passing
 * it to hook callbacks. This function handles all observed shapes:
 *   - JSON string   → parsed directly (in-process MCP via createSdkMcpServer)
 *   - { structuredContent } object → unwrapped (external MCP over SSE)
 *   - plain object  → returned as-is (fallback)
 */
export function getMcpStructured(tool_response: unknown): unknown {
  if (typeof tool_response === "string") {
    try {
      return JSON.parse(tool_response) as unknown;
    } catch {
      return undefined;
    }
  }
  if (typeof tool_response === "object" && tool_response !== null) {
    return "structuredContent" in tool_response
      ? (tool_response as { structuredContent: unknown }).structuredContent
      : tool_response;
  }
  return undefined;
}

const AWAIT_TOOL_STATUSES = [
  "completed",
  "canceled",
  "failed",
  "rejected",
  "still_running",
] as const;
export type AwaitToolStatus = (typeof AWAIT_TOOL_STATUSES)[number];

function isAwaitToolStatus(s: unknown): s is AwaitToolStatus {
  return (AWAIT_TOOL_STATUSES as readonly unknown[]).includes(s);
}

/** Extracts and narrows the `status` field from a PostToolUse `tool_response`. Returns undefined when absent or not a known AwaitToolStatus. */
export function getAwaitStatus(tool_response: unknown): AwaitToolStatus | undefined {
  const structured = getMcpStructured(tool_response);
  if (typeof structured !== "object" || structured === null || !("status" in structured)) {
    return undefined;
  }
  const { status } = structured as { status: unknown };
  return isAwaitToolStatus(status) ? status : undefined;
}

// ─── Links reminder ──────────────────────────────────────────────────────────

const HANDOFF_GUIDANCE_DIR = path.join(AGENTS_ROOT, "lib", "handoff-guidance");
const STRATEGY_GUIDANCE_FILES: Record<string, string> = {
  chat: "chat.md",
  review: "review.md",
  escalation: "escalate.md",
};

/**
 * Builds a PostToolUse reminder for the completed agent's outgoing links.
 *
 * Returns a compact XML block listing each linked agent with its score range
 * and a path to the relevant handoff guidance. The agent reads the guidance,
 * scores each target, and calls the ones in range — no external script needed.
 *
 * Returns null when the agent has no outgoing links.
 */
export async function buildLinksReminder(
  completedAgentName: string,
  agents: AgentDef[],
  excludeAgentName?: string,
): Promise<string | null> {
  const links = await readAgentLinks();
  const outgoing = resolveLinkedTargets(completedAgentName, links).filter(
    (l) => l.targetName !== excludeAgentName,
  );
  if (outgoing.length === 0) return null;

  // scoreKey is unique per (agent, strategy) pair; toolKey maps to start_*/ask_* tool names.
  const linkDefs = outgoing.map((link) => {
    const targetDef = agents.find((a) => a.name === link.targetName);
    const toolKey = targetDef?.manifestKey ?? link.targetName.replace(/-/g, "_");
    const scoreKey = link.strategy === "chat" ? toolKey : `${toolKey}__${link.strategy}`;
    return {
      scoreKey,
      toolKey,
      name: link.targetName,
      strategy: link.strategy,
      handoffScoreMin: link.handoffScoreMin,
      handoffScoreMax: link.handoffScoreMax,
    };
  });

  const strategies = [...new Set(linkDefs.map((l) => l.strategy))];
  const guidanceLines = strategies.map((strategy) => {
    const file = STRATEGY_GUIDANCE_FILES[strategy] ?? "chat.md";
    return `<guidance strategy="${strategy}">MUST read \`${path.join(HANDOFF_GUIDANCE_DIR, file)}\` to understand the pattern before scoring</guidance>`;
  });

  const toolsXml = linkDefs
    .map((l) =>
      [
        `  <tool>`,
        `    <scoreKey>${l.scoreKey}</scoreKey>`,
        `    <toolKey>${l.toolKey}</toolKey>`,
        `    <strategy>${l.strategy}</strategy>`,
        `    <range>${l.handoffScoreMin}–${l.handoffScoreMax}</range>`,
        `  </tool>`,
      ].join("\n"),
    )
    .join("\n");

  return [
    `<links>`,
    ...guidanceLines,
    `<tools>`,
    toolsXml,
    `</tools>`,
    `<check>For each tool: read its guidance file, score 0–100. If the score falls within the stated range, you MUST START the agent immediately using start_* — no exceptions, no reasoning about whether to skip.</check>`,
    `</links>`,
  ].join("\n");
}

// ─── Generic hook builder ─────────────────────────────────────────────────────

export interface AgentHooksConfig {
  /** Pipe-separated tool name matcher for the PostToolUse still_running hook. */
  postToolUseMatcher: string;
  /** Registry tracking all pending in-flight operations. */
  registry: PendingRegistry;
  /** Appended to every user prompt via UserPromptSubmit hook. */
  userPromptReminder?: string;
  /**
   * Directories (cwd + additionalDirectories) that Edit/Write tools are
   * permitted to modify. Paths outside this set are denied via PreToolUse.
   */
  allowedDirectories?: string[];
  /**
   * Tools to block via PreToolUse hook (2nd-level gate, in addition to SDK disallowedTools).
   * Matcher is built dynamically from this list.
   */
  disallowedTools?: string[];
  /** When true, blocks Bash write operations (redirects, sed -i) via PreToolUse. */
  readOnly?: boolean;
}

const STILL_RUNNING_FULL_EVERY = 5;

function buildPendingBlockReason(entries: PendingEntry[]): string {
  return [
    `⚠️ You have ${entries.length} pending operation(s) still running:`,
    ...entries.map((e) => `- call \`${e.awaitTool}\` with ${e.idKey}: "${e.id}"`),
    `These operations can run for a long time (minutes to hours) — decide an appropriate sleep interval based on the task type.`,
    `Keep calling await in a loop until the operation completes.`,
    `Never give up or stop polling; you are responsible for retrieving the final result.`,
    `Never recall any previous run from log or memory — always use the await tool with the id from the most recent still_running response.`,
  ].join("\n");
}

function buildShortPendingBlockReason(entries: PendingEntry[]): string {
  return `Keep polling: ${entries.map((e) => `\`${e.awaitTool}\` ${e.idKey}="${e.id}"`).join(", ")}`;
}

/**
 * Builds a pair of hooks (PostToolUse + Stop) from a generic config.
 * Suitable for any query() call that uses a start/await tool pattern.
 */
export function buildAgentHooks(
  config: AgentHooksConfig,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const {
    postToolUseMatcher,
    registry,
    userPromptReminder,
    allowedDirectories,
    disallowedTools,
    readOnly,
  } = config;
  let stillRunningCount = 0;
  // Resolve canonical paths once at setup (normalises symlinks + macOS case-insensitive FS).
  const resolvedAllowed =
    allowedDirectories && allowedDirectories.length > 0
      ? Promise.all(allowedDirectories.map((d) => realpath(d).catch(() => path.resolve(d))))
      : undefined;

  const preToolUseHooks: HookCallbackMatcher[] = [
    {
      matcher: "ScheduleWakeup",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          if (!registry.hasPending()) return { continue: true };
          const pending = registry.getPending();
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: [
              `⚠️ ScheduleWakeup cannot be used while await operations are pending — the wakeup will not fire in this session context.`,
              `You still have ${pending.length} pending operation(s):`,
              ...pending.map((e) => `- call \`${e.awaitTool}\` with ${e.idKey}: "${e.id}"`),
              `Keep calling the await tool directly in a loop until the operation completes.`,
              `Never schedule a wakeup to defer polling — poll in-session.`,
            ].join("\n"),
          };
          return { hookSpecificOutput };
        },
      ],
    },
  ];

  // 2nd-level gate: deny tools in the disallowedTools list (SDK disallowedTools is the 1st gate).
  // Filter out Bash(command *) patterns — those are SDK-level; hooks only match on plain tool names.
  const hookBlockedTools = disallowedTools?.filter((t) => !t.includes("(")) ?? [];
  if (hookBlockedTools.length > 0) {
    const matcher = hookBlockedTools.join("|");
    preToolUseHooks.push({
      matcher,
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Tool is not permitted in this mode.`,
          };
          return { hookSpecificOutput };
        },
      ],
    });
  }

  // Block Bash write operations (redirects, rm, mv, etc.) when in read-only mode.
  if (readOnly) {
    preToolUseHooks.push({
      matcher: "Bash",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          if (typeof input.tool_input !== "object" || input.tool_input === null)
            return { continue: true };
          const rawCommand: unknown = Reflect.get(input.tool_input, "command");
          const command = typeof rawCommand === "string" ? rawCommand : "";
          if (!bashHasWriteOperation(command)) return { continue: true };
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Read-only mode: Bash write operations are not allowed.",
          };
          return { hookSpecificOutput };
        },
      ],
    });
  }

  if (resolvedAllowed) {
    preToolUseHooks.push({
      matcher: "Edit|Write",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          if (typeof input.tool_input !== "object" || input.tool_input === null)
            return { continue: true };
          const fp: unknown = Reflect.get(input.tool_input, "file_path");
          const filePath = typeof fp === "string" ? fp : undefined;
          if (!filePath) return { continue: true };
          // Resolve canonical path (normalises symlinks + macOS case-insensitive FS).
          // File may not exist yet (new write) — fall back to path.resolve.
          const resolved = await realpath(filePath).catch(() => path.resolve(filePath));
          const dirs = await resolvedAllowed;
          const allowed = dirs.some(
            (dir) => resolved === dir || resolved.startsWith(dir + path.sep),
          );
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: allowed ? "allow" : "deny",
            ...(!allowed && {
              permissionDecisionReason: `"${resolved}" is outside the allowed directories: ${dirs.join(", ")}.
                    You should stop and reconsider if you really need to access this path.
                    But NEVER proceed without explicit permission or try to bypass it automatically, as allowing access to this path could be dangerous.
                    If you really need to access this path, ask the user for explicit permission.`,
            }),
          };
          return { hookSpecificOutput };
        },
      ],
    });
  }

  // Read is non-destructive — always allow without prompting the user.
  preToolUseHooks.push({
    matcher: "Read",
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PreToolUse") return { continue: true };
        if (input.tool_name !== "Read") return { continue: true };
        const hookSpecificOutput: PreToolUseHookSpecificOutput = {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        };
        return { hookSpecificOutput };
      },
    ],
  });

  return {
    ...(userPromptReminder && {
      UserPromptSubmit: [
        {
          hooks: [
            async (input) => {
              if (input.hook_event_name !== "UserPromptSubmit") return { continue: true };
              const hookSpecificOutput: UserPromptSubmitHookSpecificOutput = {
                hookEventName: "UserPromptSubmit",
                additionalContext: userPromptReminder,
              };
              return { hookSpecificOutput };
            },
          ],
        },
      ],
    }),
    PreToolUse: preToolUseHooks,
    Stop: [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "Stop") return { continue: true };
            if (!registry.hasPending()) return { continue: true };
            return { decision: "block", reason: buildPendingBlockReason(registry.getPending()) };
          },
        ],
      },
    ],
    PostToolUse: [
      {
        matcher: postToolUseMatcher,
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PostToolUse") return { continue: true };
            const { tool_response } = input;
            const status = getAwaitStatus(tool_response);
            if (status === "still_running") {
              stillRunningCount++;
              const isFullReminder = stillRunningCount % STILL_RUNNING_FULL_EVERY === 1;
              const pending = registry.getPending();
              const reason = isFullReminder
                ? buildPendingBlockReason(pending)
                : buildShortPendingBlockReason(pending);
              return { decision: "block", reason };
            }
            return { continue: true };
          },
        ],
      },
    ],
  };
}

// ─── Justification gate ───────────────────────────────────────────────────────

/**
 * PreToolUse hook that validates justification before any start_* agent delegation call.
 * Does not apply to start_script_* tools (those have no justification field in their schema).
 * Denies the call when justification is missing, impact is invalid, impact
 * is "low" (never hand off), or confidence is below the impact threshold.
 */
export function makeJustificationGateHook(
  matcher = "mcp__agents__start_(?!script_).*",
): HookCallbackMatcher {
  const impactKeys = Object.keys(CONFIDENCE_THRESHOLD).join("|");
  return {
    matcher,
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PreToolUse") return { continue: true };
        if (typeof input.tool_input !== "object" || input.tool_input === null)
          return { continue: true };
        const just: unknown = Reflect.get(input.tool_input, "justification");

        if (typeof just !== "object" || just === null) {
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `justification is required before calling start_*. Provide: impact (${impactKeys}), confidence (0–100), pattern, handoff.`,
          };
          return { hookSpecificOutput };
        }

        const impact: unknown = Reflect.get(just, "impact");
        const confidence: unknown = Reflect.get(just, "confidence");
        const impactKey =
          typeof impact === "string" && impact in CONFIDENCE_THRESHOLD ? impact : undefined;

        if (!impactKey) {
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `impact "${String(impact)}" is invalid. Use: ${impactKeys}.`,
          };
          return { hookSpecificOutput };
        }

        const entry = CONFIDENCE_THRESHOLD[impactKey];
        if (entry.threshold === Infinity) {
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Low-impact handoffs must not use start_*. Share via message instead, or raise the impact level if genuinely consequential.`,
          };
          return { hookSpecificOutput };
        }

        if (typeof confidence !== "number" || confidence < entry.threshold) {
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `Confidence ${typeof confidence === "number" ? confidence : "missing"} is below the ${impactKey} threshold of ${entry.threshold}. Raise confidence or reconsider this handoff.`,
          };
          return { hookSpecificOutput };
        }

        return { continue: true };
      },
    ],
  };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Hooks for Dove's top-level query() in route.ts. */
export function buildDoveHooks(
  agents: AgentDef[],
  registry: PendingRegistry,
  cwd: string,
  additionalDirectories: string[],
  options: {
    includeGroupReminder?: boolean;
    disallowedTools?: string[];
    readOnly?: boolean;
    behaviorReminder?: string;
  } = {},
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const userPromptReminder = options.includeGroupReminder
    ? buildDovePromptReminder(options.behaviorReminder)
    : buildDoveLeanReminder(options.behaviorReminder);
  const hooks = buildAgentHooks({
    postToolUseMatcher: agents.map((a) => `mcp__agents__${doveAwaitToolName(a)}`).join("|"),
    registry,
    userPromptReminder,
    allowedDirectories: [cwd, ...additionalDirectories],
    disallowedTools: options.disallowedTools,
    readOnly: options.readOnly,
  });
  // Instruction reminder — injects additionalContext before any start_* / start_group_* call.
  hooks.PreToolUse = [
    ...(hooks.PreToolUse ?? []),
    {
      matcher: "mcp__agents__start_.*",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return { continue: true };
          const hookSpecificOutput: PreToolUseHookSpecificOutput = {
            hookEventName: "PreToolUse",
            additionalContext: "Read instruction description and tool description carefully",
          };
          return { hookSpecificOutput };
        },
      ],
    },
    // Group orchestrator score gate — denies if groupOrchestrationScore is absent or < 80.
    ...(options.includeGroupReminder
      ? [
          {
            matcher: "mcp__agents__start_.*",
            hooks: [
              async (input: Parameters<HookCallbackMatcher["hooks"][number]>[0]) => {
                if (input.hook_event_name !== "PreToolUse") return { continue: true };
                if (typeof input.tool_input !== "object" || input.tool_input === null)
                  return { continue: true };
                const group: unknown = Reflect.get(input.tool_input, "group");
                // group: null or group: {} → explicit non-group signal, allow through
                if (
                  group === null ||
                  (typeof group === "object" && group !== null && Object.keys(group).length === 0)
                )
                  return { continue: true };
                const groupOrchestrationScore: unknown =
                  typeof group === "object" && group !== null
                    ? Reflect.get(group, "groupOrchestrationScore")
                    : Reflect.get(input.tool_input, "groupOrchestrationScore"); // start_group_* keeps score at top level
                if (typeof groupOrchestrationScore === "number" && groupOrchestrationScore >= 80)
                  return { continue: true };
                const isMissing = typeof groupOrchestrationScore !== "number";
                const hookSpecificOutput: PreToolUseHookSpecificOutput = {
                  hookEventName: "PreToolUse",
                  permissionDecision: "deny",
                  permissionDecisionReason: isMissing
                    ? [
                        "`groupOrchestrationScore` is missing from your tool call.",
                        "Before recalling — ask yourself: are you currently orchestrating a group, team chat, or team task? Have you already called `start_group_*` in this session?",
                        "If YES — **HARD RULE, NO EXCEPTIONS:** you MUST recall this tool with the `group` field populated including `groupOrchestrationScore`.",
                        "NEVER omit it. NEVER claim you are not in group context to skip it. NEVER invent a separate score outside the `group` field.",
                        "If NO — you are making a plain single-agent call. Recall the tool with `group: null` to confirm you are not in group context.",
                        "",
                        GROUP_ORCHESTRATOR_REMINDER,
                      ].join("\n")
                    : [
                        GROUP_ORCHESTRATOR_REMINDER,
                        "",
                        `Your \`groupOrchestrationScore\` is ${groupOrchestrationScore} (must be >= 80 to proceed).`,
                        "First — ask yourself: are you currently orchestrating a group, team chat, or team task? Have you already called `start_group_*` in this session?",
                        "If NO — recall the tool with `group: null` to confirm you are not in group context.",
                        "If YES — this is an orchestration behaviour score: are you stopping too early, and is the instruction free of pre-assigned handoffs?",
                        "Re-read the rules above, fix any issues in your approach, then recall the tool with a score that honestly reflects your behaviour.",
                      ].join("\n"),
                };
                return { hookSpecificOutput };
              },
            ],
          } satisfies HookCallbackMatcher,
        ]
      : []),
  ];
  const startMatcher = agents.map((a) => `mcp__agents__${doveStartToolName(a)}`).join("|");
  if (startMatcher) {
    hooks.PreToolUse = [...(hooks.PreToolUse ?? []), makeJustificationGateHook(startMatcher)];
  }
  const awaitMatcher = agents.map((a) => `mcp__agents__${doveAwaitToolName(a)}`).join("|");
  if (awaitMatcher) {
    hooks.PostToolUse = [
      ...(hooks.PostToolUse ?? []),
      {
        matcher: awaitMatcher,
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PostToolUse") return { continue: true };
            if (getAwaitStatus(input.tool_response) !== "completed") return { continue: true };
            const manifestKey = input.tool_name.replace(/^mcp__agents__await_/, "");
            const agentDef = agents.find((a) => a.manifestKey === manifestKey);
            const linksReminder = agentDef ? await buildLinksReminder(agentDef.name, agents) : null;
            if (linksReminder) {
              return { decision: "block", reason: linksReminder };
            }
            const hookSpecificOutput: PostToolUseHookSpecificOutput = {
              hookEventName: "PostToolUse",
              additionalContext: `<reminder>\n${DOVE_RESPONSE_REMINDER}\n</reminder>`,
            };
            return { hookSpecificOutput };
          },
        ],
      },
    ];
  }

  return hooks;
}

/**
 * Builds the canUseTool callback for Dove's query().
 *
 * The SDK sends a `can_use_tool` control request when Claude Code needs
 * permission to use a tool (including sensitive-path operations that
 * `permissionMode: "acceptEdits"` doesn't auto-approve). This callback
 * sends a `permission` SSE event to the browser and awaits the user's
 * decision before returning allow/deny to the SDK.
 *
 * Returns both the callback and an `abort` function that denies all
 * in-flight permission requests for this specific query — scoped so that
 * cancelling one session doesn't affect concurrent sessions in other tabs.
 */
export function buildDoveCanUseTool(send: (event: ChatSseEvent) => void): {
  canUseTool: CanUseTool;
  abortPermissions: () => void;
} {
  const activePermissionIds = new Set<string>();
  const activeQuestionIds = new Set<string>();

  const canUseTool: CanUseTool = async (
    toolName,
    input,
    { title, displayName, blockedPath, signal },
  ) => {
    // ── AskUserQuestion: surface questions to the browser and await answers ──
    if (toolName === "AskUserQuestion") {
      // input is Record<string, unknown> — index directly, no assertion needed.
      const rawQuestions = input["questions"];
      // After Array.isArray, TypeScript narrows to any[] (isArray's own signature).
      // The SDK validates AskUserQuestion's schema before canUseTool fires, so
      // the array really does contain Question objects.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK-validated schema
      const questions = (Array.isArray(rawQuestions) ? rawQuestions : []) as Question[];
      const requestId = randomUUID();
      activeQuestionIds.add(requestId);
      send({ type: "question", requestId, questions });
      const abortPromise = new Promise<Record<string, string>>((resolve) => {
        signal.addEventListener("abort", () => resolve({}), { once: true });
      });
      const answers = await Promise.race([addPendingQuestion(requestId), abortPromise]);
      if (signal.aborted) abortPendingQuestions(new Set([requestId]));
      activeQuestionIds.delete(requestId);
      return {
        behavior: "allow" as const,
        updatedInput: { ...(input as object), answers },
      };
    }

    // ── All other tools: permission approval flow ────────────────────────────
    const requestId = randomUUID();
    activePermissionIds.add(requestId);
    send({
      type: "permission",
      requestId,
      toolName: displayName ?? toolName,
      toolInput: blockedPath ? { ...input, file_path: blockedPath } : input,
      title: title ?? undefined,
    });
    // Race user response against SDK abort (e.g. user cancels while prompt is open).
    // If aborted first, deny immediately so query() can unwind without deadlocking.
    const abortPromise = new Promise<false>((resolve) => {
      signal.addEventListener("abort", () => resolve(false), { once: true });
    });
    const allowed = await Promise.race([addPendingPermission(requestId), abortPromise]);
    // If abort won the race the POST never arrived, so the resolver is still in the map.
    // (If the user responded, resolvePendingPermission already removed it — this is a no-op.)
    if (signal.aborted) abortPendingPermissions(new Set([requestId]));
    activePermissionIds.delete(requestId);
    return allowed
      ? { behavior: "allow" as const, updatedInput: input }
      : { behavior: "deny" as const, message: "User denied permission" };
  };

  return {
    canUseTool,
    abortPermissions: () => {
      abortPendingPermissions(activePermissionIds);
      abortPendingQuestions(activeQuestionIds);
    },
  };
}

/**
 * Builds the canUseTool callback for a subagent running in an A2A process.
 *
 * Since the A2A process is a separate OS process, it cannot call send() or
 * addPendingPermission() directly. Instead, this callback POSTs to
 * /api/internal/subagent-permission — a long-poll endpoint in Next.js that
 * pushes the permission event to the browser and awaits the user's response
 * before responding { allowed } back to the A2A caller.
 */
export function buildSubagentCanUseTool(
  contextId: string,
  dovePort: string,
  abortSignal?: AbortSignal,
): CanUseTool {
  return async (toolName, input, { title, displayName, blockedPath, signal }) => {
    const requestId = randomUUID();
    const abortPromise = new Promise<false>((resolve) => {
      signal.addEventListener("abort", () => resolve(false), { once: true });
    });
    const allowed = await Promise.race([
      fetch(`http://127.0.0.1:${dovePort}/api/internal/subagent-permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contextId,
          requestId,
          toolName: displayName ?? toolName,
          toolInput: blockedPath ? { ...input, file_path: blockedPath } : input,
          title: title ?? undefined,
        }),
        ...(abortSignal ? { signal: abortSignal } : {}),
      })
        .then((r) => r.ok)
        .catch(() => false as const),
      abortPromise,
    ]);
    return allowed
      ? { behavior: "allow" as const, updatedInput: input }
      : { behavior: "deny" as const, message: "User denied permission" };
  };
}
