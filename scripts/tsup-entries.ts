import { join } from "node:path";
import { isCompiledAgentScript, type AgentConfigEntry } from "../lib/agents-config-schemas.js";

/**
 * Build the tsup entry map from agent config entries.
 * Skips agents whose scriptFile is not TypeScript (e.g. .sh, .py, .rb).
 */
export function buildTsupEntries(entries: AgentConfigEntry[]): Record<string, string> {
  return Object.fromEntries(
    entries
      .filter((a) => isCompiledAgentScript(a.scriptFile ?? "main.ts"))
      .map((a) => {
        const scriptFile = a.scriptFile ?? "main.ts";
        const entryFile = a.pluginPath
          ? join(a.pluginPath, "agents", a.name, scriptFile)
          : `agent-local/${a.name}/${scriptFile}`;
        return [`agents/${a.name}`, entryFile];
      }),
  );
}
