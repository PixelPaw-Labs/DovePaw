import type { DoveMode } from "./settings-schemas";

// Matches shell redirect writes and sed in-place edits.
// Named write commands (rm, mv, cp, etc.) are already blocked via Bash(cmd *) patterns above.
const BASH_WRITE_RE = />\s*\S|sed\s+[^|&;]*-i/;

export function bashHasWriteOperation(command: string): boolean {
  // Strip quoted strings to avoid matching redirects inside them.
  const stripped = command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  return BASH_WRITE_RE.test(stripped);
}

export interface DoveModeStrategy {
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  settingSources: ("project" | "user" | "local")[];
  allowDangerouslySkipPermissions: boolean;
  readOnly: boolean;
  /** Tools blocked entirely via SDK disallowedTools + PreToolUse hook (2nd gate). */
  disallowedTools: string[];
}

const ALL_SETTINGS_SOURCES = ["project", "user", "local"] as const;

// Read-only mode: allow only Read/Glob/Grep/Bash (+ AskUserQuestion/Skill/ToolSearch meta tools).
// All write-capable or system-mutating tools from the tools reference are disallowed.
// Bash(interpreter *) patterns block script interpreters that can write files.
const READ_ONLY_DISALLOWED_TOOLS = [
  // File write tools
  "Write",
  "Edit",
  "NotebookEdit",
  "TodoWrite",
  // Shell write commands (prefix-matched by SDK)
  "Bash(rm *)",
  "Bash(mv *)",
  "Bash(cp *)",
  "Bash(mkdir *)",
  "Bash(rmdir *)",
  "Bash(touch *)",
  "Bash(tee *)",
  "Bash(dd *)",
  "Bash(truncate *)",
  "Bash(chmod *)",
  "Bash(chown *)",
  "Bash(ln *)",
  "Bash(install *)",
  // Shell interpreters that can write
  "PowerShell",
  "Bash(python *)",
  "Bash(python3 *)",
  "Bash(node *)",
  "Bash(nodejs *)",
  "Bash(ruby *)",
  "Bash(perl *)",
  "Bash(php *)",
  // Agent/task management (write operations)
  "Agent",
  "TaskCreate",
  "TaskStop",
  "TaskUpdate",
  "TeamCreate",
  "TeamDelete",
  "SendMessage",
  // System scheduling
  "CronCreate",
  "CronDelete",
  // Worktree management (creates/destroys git worktrees)
  "EnterWorktree",
];

export function getDoveModeStrategy(mode: DoveMode): DoveModeStrategy {
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
