import { LAUNCH_AGENTS_DIR } from "@@/lib/paths";
import {
  AGENTS_ROOT,
  AGENT_SETTINGS_DIR,
  DOVEPAW_AGENT_LOGS,
  DOVEPAW_AGENT_STATE,
  SCHEDULER_ROOT,
} from "@/lib/paths";

/** Additional directories Dove needs to inspect launchd artifacts. */
export function getLaunchdAdditionalDirs(): string[] {
  return [LAUNCH_AGENTS_DIR, SCHEDULER_ROOT];
}

/** System prompt section covering the launchd/cron/scheduler workflow. */
export function buildLaunchdSystemPromptSection(): string {
  return `**How changes work — codebase is the source of truth:**

The installed plist files and \`.mjs\` scripts under \`${SCHEDULER_ROOT}/\` are **build artifacts** — they are generated from TypeScript source and wiped on every reinstall. Any direct edit to them will be lost the next time the user runs build commands.

To make a persistent change (schedule, label, description, default instruction, env vars, system prompt, or anything else):
1. Edit the **source code** in \`${AGENTS_ROOT}/\` — agent definitions (displayName, description, schedule, icon) live in \`${AGENT_SETTINGS_DIR}/<agent-name>/agent.json\`, Dove and per-agent chat behaviour live in the chatbot API routes
2. Run \`cd ${AGENTS_ROOT} && npm run install\` to build, generate plists, and reload launchd

The \`additionalDirectories\` (installed plists + scheduler scripts) are exposed to you for **read-only** purposes only — auditing what is currently installed, monitoring status, tailing logs, and unloading or deleting agents. Never write to them directly.

After editing any source file in \`${AGENTS_ROOT}/\`, always ask the user: "Do you want me to rebuild and reinstall now? — never run it automatically.

**launchd global management:**

Scripts location: ${SCHEDULER_ROOT}/
Logs location:    ${DOVEPAW_AGENT_LOGS}/

| Task | Command |
|---|---|
| Install / reinstall all agents | \`cd ${AGENTS_ROOT} && npm run build && npm run install\` |
| Uninstall all agents | \`cd ${AGENTS_ROOT} && npm run uninstall\` |
| List all loaded agents | \`launchctl list | grep claude\` |

For per-agent commands (install, uninstall, load, unload, status, tail logs) — call the agent's tool, the sub-agent owns its own lifecycle.

**Cron directory rules** (\`${SCHEDULER_ROOT}/\`)**:

This directory contains deployed .mjs scripts and native node_modules. Treat it as read-only.

| Path | Rule |
|---|---|
| \`${SCHEDULER_ROOT}/*.mjs\` | READ ONLY — never modify scripts |
| \`${SCHEDULER_ROOT}/node_modules/\` | READ ONLY — never modify |
| \`${DOVEPAW_AGENT_LOGS}/\` | RESTRICTED — may only be modified or deleted with explicit user permission |
| \`${DOVEPAW_AGENT_STATE}/\` | RESTRICTED — may only be modified with explicit user permission |

The \`state/\` folder contains lock, processed files and other state persistence files.
- You MAY query these state files at any time to read current status, progress, and results of your agents.
- You MUST NOT modify, delete, or write to any file in \`state/\` unless the user explicitly instructs you to. This includes lock files — never delete or modify them yourself to work around a stuck agent. Instead, ask the user to intervene and run the appropriate command.
- If you need to reset an agent's state as part of its normal operation, ask the user for permission first and explain the consequences (e.g. "This will delete all progress and results for that agent, are you sure?").`;
}
