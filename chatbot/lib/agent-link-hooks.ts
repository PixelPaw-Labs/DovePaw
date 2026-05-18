/**
 * Sub-agent script PostToolUse hooks.
 *
 * Fires on `await_run_script_*` — the sub-agent's own script-execution tool —
 * not on peer-handoff tools (those were removed when the cascade pattern was
 * replaced by orchestrator-owned chaining). Used in group mode to keep the
 * member in its script-defined voice and to save group "moments" to memory.
 */

import type {
  PostToolUseHookSpecificOutput,
  HookCallbackMatcher,
} from "@anthropic-ai/claude-agent-sdk";
import { awaitRunScriptToolName } from "@/lib/agent-tools";
import { getAwaitStatus } from "@/lib/hooks";
import { getMemoryProvider } from "@/lib/memory";

export function makeGroupMomentSaveHook(workspacePath: string): HookCallbackMatcher {
  return {
    matcher: `mcp__agents__${awaitRunScriptToolName(".*")}`,
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PostToolUse") return { continue: true };
        if (getAwaitStatus(input.tool_response) !== "completed") return { continue: true };
        const provider = await getMemoryProvider();
        const savePrompt = provider.buildSaveReminder(workspacePath);
        return {
          decision: "block",
          reason: `<reminder>\n${savePrompt}\n</reminder>`,
        };
      },
    ],
  };
}

export function makeGroupScriptAwaitToneHook(manifestKey: string): HookCallbackMatcher {
  return {
    matcher: `mcp__agents__${awaitRunScriptToolName(manifestKey)}`,
    hooks: [
      async (input) => {
        if (input.hook_event_name !== "PostToolUse") return { continue: true };
        if (getAwaitStatus(input.tool_response) === "still_running") return { continue: true };
        const hookSpecificOutput: PostToolUseHookSpecificOutput = {
          hookEventName: "PostToolUse",
          additionalContext: `<reminder>Respond in your own voice and tone as defined by your agent script role.</reminder>`,
        };
        return { hookSpecificOutput };
      },
    ],
  };
}
