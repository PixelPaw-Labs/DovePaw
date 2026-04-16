/**
 * Per-agent notification service.
 *
 * Provides:
 *   sendNotification — dispatches a message to a configured channel (ntfy, …)
 *   buildNotificationMatchers — returns hook matchers that fire notifications only
 *     when the agent script actually starts or completes:
 *       onSessionStart → PreToolUse on start_run_script
 *       onSessionEnd   → PostToolUse on await_run_script when status === "completed"
 *
 * Channel dispatch is intentionally fire-and-forget: failures are silently
 * swallowed so a broken ntfy topic never blocks the agent session.
 */

import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import { START_SCRIPT_TOOL, AWAIT_SCRIPT_TOOL } from "@/lib/agent-tools";
import type { AgentNotificationConfig } from "@@/lib/settings-schemas";

// ─── Env-var reference resolution ────────────────────────────────────────────

function resolveEnvRef(value: string, env: Record<string, string | undefined>): string {
  const match = /^\$\{([^}]+)\}$/.exec(value) ?? /^\$([A-Z_][A-Z0-9_]*)$/i.exec(value);
  if (!match) return value;
  return env[match[1]] ?? "";
}

// ─── Channel dispatch ─────────────────────────────────────────────────────────

async function sendNtfyNotification(
  server: string,
  topic: string,
  title: string,
  message: string,
  priority: number,
): Promise<void> {
  await fetch(`${server}/${topic}`, {
    method: "POST",
    headers: {
      Title: title,
      Priority: String(priority),
      "Content-Type": "text/plain",
    },
    body: message,
  });
}

/** Send a notification through the configured channel. Errors are swallowed. */
export async function sendNotification(
  channel: AgentNotificationConfig["channel"],
  title: string,
  message: string,
  priority = 3,
): Promise<void> {
  try {
    if (channel.type === "ntfy") {
      await sendNtfyNotification(channel.server, channel.topic, title, message, priority);
    }
  } catch {
    // Non-blocking — a broken channel must never surface to the agent
  }
}

// ─── Hook matchers ────────────────────────────────────────────────────────────

/**
 * Returns PreToolUse / PostToolUse HookCallbackMatcher entries keyed by event,
 * firing notifications only when the agent script starts or completes.
 * Returns an empty object when disabled.
 */
export function buildNotificationHooks(
  agentDisplayName: string,
  config: AgentNotificationConfig,
  env?: Record<string, string | undefined>,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  if (!config.enabled) return {};

  const channel: AgentNotificationConfig["channel"] =
    env && config.channel.type === "ntfy"
      ? {
          type: "ntfy",
          topic: resolveEnvRef(config.channel.topic, env),
          server: resolveEnvRef(config.channel.server, env),
        }
      : config.channel;

  const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {};

  if (config.onSessionStart) {
    hooks.PreToolUse = [
      {
        matcher: `mcp__agents__${START_SCRIPT_TOOL}`,
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PreToolUse") return { continue: true };
            const timestamp = new Date().toLocaleTimeString();
            void sendNotification(
              channel,
              `[${agentDisplayName}] Script started`,
              `Started at ${timestamp}`,
            );
            return { continue: true };
          },
        ],
      },
    ];
  }

  if (config.onSessionEnd) {
    hooks.PostToolUse = [
      {
        matcher: `mcp__agents__${AWAIT_SCRIPT_TOOL}`,
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "PostToolUse") return { continue: true };
            const { tool_response } = input;
            const structured =
              typeof tool_response === "object" &&
              tool_response !== null &&
              "structuredContent" in tool_response
                ? (tool_response as { structuredContent: unknown }).structuredContent
                : undefined;
            if (
              !structured ||
              typeof structured !== "object" ||
              Reflect.get(structured, "status") !== "completed"
            )
              return { continue: true };
            const timestamp = new Date().toLocaleTimeString();
            void sendNotification(
              channel,
              `[${agentDisplayName}] ✓ Script finished`,
              `Finished at ${timestamp}`,
            );
            return { continue: true };
          },
        ],
      },
    ];
  }

  return hooks;
}
