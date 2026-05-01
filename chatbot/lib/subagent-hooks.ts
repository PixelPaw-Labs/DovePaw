/**
 * Hook configuration specific to the QueryAgentExecutor sub-agent query().
 *
 * Separated from hooks.ts (generic/Dove hooks) so sub-agent concerns
 * — script start/await reminder, agent link self-reflection gate — are
 * owned and maintained here independently.
 */

export * from "./agent-link-hooks";

import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import {
  buildReflectionMatchers,
  buildHandoffConsiderationPrompt,
  groupStartHandoffHook,
  groupAwaitHandoffHook,
  makeGroupScriptAwaitToneHook,
} from "@/lib/agent-link-hooks";
import { buildAgentHooks } from "@/lib/hooks";
import { buildNotificationHooks } from "@/lib/notifications";
import type { PendingRegistry } from "@/lib/pending-registry";
import type { AgentNotificationConfig } from "@@/lib/settings-schemas";

// ─── Script reminder ──────────────────────────────────────────────────────────

export const SUBAGENT_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), tell the user what you've kicked off, then WAIT as a **background Task** concurrently.
</reminder>`;

export const GROUP_PROMPT_REMINDER = `<reminder>
- When the user's intent is resolved by SOMETHING BEING DONE: ALWAYS START yourself first (returns runId immediately), then WAIT as a **background Task** concurrently.
- Do NOT output and respond with any text such as narration, status updates, or confirmations.
</reminder>`;

// ─── Builder ──────────────────────────────────────────────────────────────────

/** Hooks for the QueryAgentExecutor sub-agent query(). */
export function buildSubAgentHooks(
  cwd: string,
  additionalDirectories: string[],
  agentLinkTools: Array<{ name: string; description: string }>,
  registry: PendingRegistry,
  manifestKey: string,
  agentDisplayName?: string,
  notifications?: AgentNotificationConfig,
  env?: Record<string, string | undefined>,
  isGroupMode?: boolean,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const hasAgentLinks = agentLinkTools.length > 0;
  const handoffConsiderationStop: HookCallbackMatcher = {
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "Stop") return { continue: true };
        // Already reminded once this turn — let the agent stop.
        if (input.stop_hook_active) return { continue: true };
        // Pending operations exist — the base Stop hook handles that case.
        if (registry.hasPending()) return { continue: true };
        return {
          decision: "block",
          reason: buildHandoffConsiderationPrompt(
            agentLinkTools,
            isGroupMode,
            input.last_assistant_message,
          ),
        };
      },
    ],
  };

  const notifHooks =
    notifications && agentDisplayName
      ? buildNotificationHooks(manifestKey, agentDisplayName, notifications, env)
      : {};

  const base = buildAgentHooks({
    postToolUseMatcher: "mcp__agents__await_.*",
    registry,
    userPromptReminder: isGroupMode ? GROUP_PROMPT_REMINDER : SUBAGENT_PROMPT_REMINDER,
    allowedDirectories: [cwd, ...additionalDirectories],
  });
  return {
    ...base,
    PreToolUse: [
      ...(base.PreToolUse ?? []),
      ...(notifHooks.PreToolUse ?? []),
      ...buildReflectionMatchers(isGroupMode),
    ],
    PostToolUse: [
      ...(base.PostToolUse ?? []),
      ...(notifHooks.PostToolUse ?? []),
      ...(isGroupMode
        ? [groupStartHandoffHook, groupAwaitHandoffHook, makeGroupScriptAwaitToneHook(manifestKey)]
        : []),
    ],
    ...(hasAgentLinks && {
      Stop: [...(base.Stop ?? []), handoffConsiderationStop],
    }),
  };
}
