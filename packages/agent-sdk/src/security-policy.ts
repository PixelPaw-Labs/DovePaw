export type SecurityMode = "read-only" | "supervised" | "autonomous";

export interface SecurityModeStrategy {
  permissionMode: "default" | "acceptEdits" | "bypassPermissions";
  readOnly: boolean;
  disallowedTools: string[];
}

const BASH_WRITE_RE = />\s*\S|sed\s+[^|&;]*-i/;

export function bashHasWriteOperation(command: string): boolean {
  const stripped = command.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  return BASH_WRITE_RE.test(stripped);
}

export const READ_ONLY_DISALLOWED_TOOLS = [
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

export function getSecurityModeStrategy(mode: SecurityMode): SecurityModeStrategy {
  switch (mode) {
    case "read-only":
      return {
        permissionMode: "default",
        readOnly: true,
        disallowedTools: READ_ONLY_DISALLOWED_TOOLS,
      };
    case "supervised":
      return { permissionMode: "acceptEdits", readOnly: false, disallowedTools: [] };
    case "autonomous":
      return { permissionMode: "bypassPermissions", readOnly: false, disallowedTools: [] };
    default:
      mode satisfies never;
      throw new Error(`Unknown security mode: ${String(mode)}`);
  }
}
