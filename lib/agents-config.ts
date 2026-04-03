import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { agentsConfigSchema, type AgentConfigEntry } from "./agents-config-schemas";
import { buildAgentDef } from "./agents";
import { AGENTS_CONFIG_FILE, DOVEPAW_DIR } from "./paths";
import type { AgentDef } from "./agents";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tryParse(file: string): AgentConfigEntry[] | null {
  if (!existsSync(file)) return null;
  try {
    const result = agentsConfigSchema.safeParse(JSON.parse(readFileSync(file, "utf-8")));
    return result.success ? result.data.agents : null;
  } catch {
    return null;
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Read agent config entries from ~/.dovepaw/agents.json.
 * Returns [] when the file is absent. Recovers from .bak on corruption.
 */
export function readAgentConfigEntries(): AgentConfigEntry[] {
  const bak = `${AGENTS_CONFIG_FILE}.bak`;
  const primary = tryParse(AGENTS_CONFIG_FILE);

  if (primary !== null) {
    if (primary.length === 0) {
      const backup = tryParse(bak);
      if (backup && backup.length > 0) {
        copyFileSync(bak, AGENTS_CONFIG_FILE);
        return backup;
      }
    }
    return primary;
  }

  const backup = tryParse(bak);
  if (backup !== null) {
    copyFileSync(bak, AGENTS_CONFIG_FILE);
    return backup;
  }

  return [];
}

/**
 * Read agents config and hydrate each entry into a full AgentDef (with icon, derived fields, etc.)
 */
export function readAgentsConfig(): AgentDef[] {
  return readAgentConfigEntries().map(buildAgentDef);
}

/**
 * Read only agents with schedulingEnabled !== false.
 */
export function readScheduledAgentConfigEntries(): ReturnType<typeof readAgentConfigEntries> {
  return readAgentConfigEntries().filter((a) => a.schedulingEnabled !== false);
}

/**
 * Read only scheduling-enabled agents as full AgentDef[].
 */
export function readScheduledAgentsConfig(): AgentDef[] {
  return readScheduledAgentConfigEntries().map(buildAgentDef);
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Persist agent entries to ~/.dovepaw/agents.json (with .bak). */
export function writeAgentsConfig(entries: AgentConfigEntry[]): void {
  mkdirSync(DOVEPAW_DIR, { recursive: true });
  const data = JSON.stringify({ version: 1, agents: entries }, null, 2) + "\n";
  writeFileSync(AGENTS_CONFIG_FILE, data, "utf-8");
  copyFileSync(AGENTS_CONFIG_FILE, `${AGENTS_CONFIG_FILE}.bak`);
}
