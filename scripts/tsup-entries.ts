import { join } from "node:path";
import type { AgentConfigEntry } from "../lib/agents-config-schemas.js";

/**
 * Build the tsup entry map from agent config entries.
 * Skips agents whose scriptFile is not TypeScript (e.g. .sh, .py, .rb).
 */
export function buildTsupEntries(entries: AgentConfigEntry[]): Record<string, string> {
  return Object.fromEntries(
    entries
      .filter((a) => (a.scriptFile ?? "main.ts").endsWith(".ts"))
      .map((a) => {
        const scriptFile = a.scriptFile ?? "main.ts";
        const entryFile = a.pluginPath
          ? join(a.pluginPath, "agents", a.name, scriptFile)
          : `agent-local/${a.name}/${scriptFile}`;
        return [`agents/${a.name}`, entryFile];
      }),
  );
}
