/**
 * Per-agent notification service.
 *
 * Provides:
 *   sendNotification — dispatches a message to a configured channel (ntfy, …)
 *   buildNotificationHooks — returns SessionStart / SessionEnd hook matchers
 *
 * Channel dispatch is intentionally fire-and-forget: failures are silently
 * swallowed so a broken ntfy topic never blocks the agent session.
 */

import type { HookCallbackMatcher, HookEvent } from "@anthropic-ai/claude-agent-sdk";
import type { AgentNotificationConfig } from "@@/lib/settings-schemas";

// ─── Env-var reference resolution ────────────────────────────────────────────

/**
 * Resolves a $VAR or ${VAR} reference from env.
 * Returns the env value when matched, the original string otherwise.
 * Non-reference strings are returned unchanged.
 */
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

// ─── Hook builder ─────────────────────────────────────────────────────────────

/**
 * Returns SessionStart / SessionEnd HookCallbackMatcher entries for a given
 * agent notification config. Returns an empty object when disabled.
 *
 * Priority mirrors scheduler-notify.sh: 3 (normal) on clean exit, 4 (high) on error.
 * "other" and "unknown" are the SDK's normal-exit reasons.
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
    hooks.SessionStart = [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "SessionStart") return { continue: true };
            const timestamp = new Date().toLocaleTimeString();
            void sendNotification(
              channel,
              `[${agentDisplayName}] Session started`,
              `Started at ${timestamp}`,
            );
            return { continue: true };
          },
        ],
      },
    ];
  }

  if (config.onSessionEnd) {
    hooks.SessionEnd = [
      {
        hooks: [
          async (input) => {
            if (input.hook_event_name !== "SessionEnd") return { continue: true };
            const reason =
              "reason" in input && typeof input.reason === "string" ? input.reason : "unknown";
            const isError = reason !== "other" && reason !== "unknown";
            const timestamp = new Date().toLocaleTimeString();
            const title = `[${agentDisplayName}] ${isError ? "✗" : "✓"} Session ended`;
            const message = isError
              ? `Ended at ${timestamp} (${reason})`
              : `Finished at ${timestamp}`;
            void sendNotification(channel, title, message, isError ? 4 : 3);
            return { continue: true };
          },
        ],
      },
    ];
  }

  return hooks;
}
