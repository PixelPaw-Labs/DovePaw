/**
 * Hook configuration specific to the QueryAgentExecutor sub-agent query().
 *
 * Separated from hooks.ts (generic/Dove hooks) so sub-agent concerns
 * — script start/await reminder, links-reminder for orchestrator mode — are
 * owned and maintained here independently.
 */

export * from "./agent-link-hooks";

import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import type { AgentDef } from "@@/lib/agents";
import { makeGroupScriptAwaitToneHook, makeGroupMomentSaveHook } from "@/lib/agent-link-hooks";
import {
  buildAgentHooks,
  buildLinksReminder,
  getAwaitStatus,
  makeJustificationGateHook,
} from "@/lib/hooks";
import { buildNotificationHooks } from "@/lib/notifications";
import type { PendingRegistry } from "@/lib/pending-registry";
import type { AgentNotificationConfig } from "@@/lib/settings-schemas";
import { ALWAYS_DISALLOWED_TOOLS } from "@@/lib/security-policy";
import { buildGroupReminder, buildSubAgentReminder } from "@@/lib/subagent-reminder";
import { awaitRunScriptToolName } from "@/lib/agent-tools";

// ─── Builder ──────────────────────────────────────────────────────────────────

/** Hooks for the QueryAgentExecutor sub-agent query(). */
export function buildSubAgentHooks(
  cwd: string,
  additionalDirectories: string[],
  agents: AgentDef[],
  registry: PendingRegistry,
  manifestKey: string,
  agentDisplayName?: string,
  notifications?: AgentNotificationConfig,
  env?: Record<string, string | undefined>,
  isGroupMode?: boolean,
  isAskMode?: boolean,
  /** True when the user chatted directly with this sub-agent (no Dove orchestrator above it).
   *  Only direct-chat sub-agents act as their own orchestrator and receive the links reminder. */
  isDirectChat?: boolean,
  behaviorReminder?: string,
  groupMomentsPath?: string,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const notifHooks =
    notifications && agentDisplayName
      ? buildNotificationHooks(manifestKey, agentDisplayName, notifications, env)
      : {};

  const base = buildAgentHooks({
    postToolUseMatcher: "mcp__agents__await_.*",
    registry,
    userPromptReminder: isGroupMode
      ? buildGroupReminder(behaviorReminder)
      : buildSubAgentReminder(behaviorReminder),
    allowedDirectories: [cwd, ...additionalDirectories],
    disallowedTools: ALWAYS_DISALLOWED_TOOLS,
  });

  // Orchestrator-mode links reminder: only when the sub-agent is the directly
  // chatted entry point (non-group, non-ask). After any await_* completes,
  // surface the completed agent's outgoing links so the sub-agent can chain
  // the next call at its own level instead of letting a downstream cascade.
  const ownRunScriptAwaitName = `mcp__agents__${awaitRunScriptToolName(manifestKey)}`;
  const linksReminderHook: HookCallbackMatcher = {
    matcher: "mcp__agents__await_.*",
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PostToolUse") return { continue: true };
        if (getAwaitStatus(input.tool_response) !== "completed") return { continue: true };

        // Resolve the agent whose work just completed:
        //   await_run_script_<self>   → the current sub-agent itself
        //   await_<otherKey>          → a linked agent we just orchestrated
        const currentAgentName = agents.find((a) => a.manifestKey === manifestKey)?.name;
        let completedAgentName: string | undefined;
        if (input.tool_name === ownRunScriptAwaitName) {
          completedAgentName = currentAgentName;
        } else {
          const otherKey = input.tool_name.replace(/^mcp__agents__await_/, "");
          completedAgentName = agents.find((a) => a.manifestKey === otherKey)?.name;
        }
        if (!completedAgentName) return { continue: true };

        const linksReminder = await buildLinksReminder(
          completedAgentName,
          agents,
          currentAgentName,
        );
        if (!linksReminder) return { continue: true };

        return { decision: "block", reason: linksReminder };
      },
    ],
  };

  return {
    ...base,
    PreToolUse: [
      ...(base.PreToolUse ?? []),
      ...(notifHooks.PreToolUse ?? []),
      ...(!isGroupMode && !isAskMode && isDirectChat ? [makeJustificationGateHook()] : []),
    ],
    PostToolUse: [
      ...(base.PostToolUse ?? []),
      ...(notifHooks.PostToolUse ?? []),
      ...(!isGroupMode && !isAskMode && isDirectChat ? [linksReminderHook] : []),
      ...(isGroupMode
        ? [
            makeGroupScriptAwaitToneHook(manifestKey),
            ...(groupMomentsPath ? [makeGroupMomentSaveHook(groupMomentsPath)] : []),
          ]
        : []),
    ],
  };
}
