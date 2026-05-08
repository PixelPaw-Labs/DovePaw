/**
 * Platform-wide tool security policy and Dove mode strategies.
 *
 * ALWAYS_DISALLOWED_TOOLS is applied as both SDK disallowedTools and PreToolUse hook (2nd gate).
 * The hook joins these with "|" and evaluates as a regex — patterns like
 * "mcp__claude_ai_Gmail_.*" match all tools across a service's variants
 * (plain, Workato, Testing Admin Only, etc.).
 *
 * NOTE: SDK disallowedTools performs exact-name matching only, so patterns
 * here are enforced exclusively by the hook gate.
 */

import type { SecurityMode } from "./settings-schemas";
export { bashHasWriteOperation } from "@@/packages/agent-sdk/src/security-policy";
import { READ_ONLY_DISALLOWED_TOOLS } from "@@/packages/agent-sdk/src/security-policy";

// ─── Dove mode strategy ───────────────────────────────────────────────────────

export interface SecurityModeStrategy {
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  settingSources: ("project" | "user" | "local")[];
  allowDangerouslySkipPermissions: boolean;
  readOnly: boolean;
  /** Tools blocked entirely via SDK disallowedTools + PreToolUse hook (2nd gate). */
  disallowedTools: string[];
}

const ALL_SETTINGS_SOURCES = ["project", "user", "local"] as const;

export function getSecurityModeStrategy(mode: SecurityMode): SecurityModeStrategy {
  switch (mode) {
    case "read-only":
      return {
        permissionMode: "default",
        settingSources: ["project", "local"],
        allowDangerouslySkipPermissions: false,
        readOnly: true,
        disallowedTools: READ_ONLY_DISALLOWED_TOOLS,
      };
    case "supervised":
      return {
        permissionMode: "acceptEdits",
        settingSources: [...ALL_SETTINGS_SOURCES],
        allowDangerouslySkipPermissions: false,
        readOnly: false,
        disallowedTools: [],
      };
    case "autonomous":
      return {
        permissionMode: "bypassPermissions",
        settingSources: [...ALL_SETTINGS_SOURCES],
        allowDangerouslySkipPermissions: true,
        readOnly: false,
        disallowedTools: [],
      };
    default:
      mode satisfies never;
      throw new Error(`Unknown dove mode: ${String(mode)}`);
  }
}

export function buildSecurityEnv(
  mode: SecurityMode,
  allowWebTools?: boolean,
): Record<string, string> {
  const { disallowedTools } = getSecurityModeStrategy(mode);
  return {
    DOVEPAW_SECURITY_MODE: mode,
    ...(disallowedTools.length > 0 ? { DOVEPAW_DISALLOWED_TOOLS: disallowedTools.join(",") } : {}),
    ...(allowWebTools ? { DOVEPAW_ALLOW_WEB_TOOLS: "1" } : {}),
  };
}

// ─── Platform-wide blocked tools ──────────────────────────────────────────────

/** Tools blocked unconditionally across every agent and every Dove mode. */
export const ALWAYS_DISALLOWED_TOOLS: string[] = [
  // claude.ai remote MCP integrations — one pattern per service group.
  "mcp__claude_ai_Assets_.*",
  "mcp__claude_ai_Gmail_.*",
  "mcp__claude_ai_Google_Calendar_.*",
  "mcp__claude_ai_Google_Drive_.*",
  "mcp__claude_ai_Google_Sheets_.*",
  "mcp__claude_ai_HubSpot_.*",
  "mcp__claude_ai_Jira_.*",
  "mcp__claude_ai_Confluence_.*",
  "mcp__claude_ai_Slack_.*",
  "mcp__claude_ai_Slack_Workato_.*",
  "mcp__claude_ai_Envato_Creative_Companion_.*",
];
