/** Zod schemas for the DovePaw plugin system. No Node.js imports — safe in client components. */
import { z } from "zod";

// ─── Skill Symlink Targets ────────────────────────────────────────────────────

export const BUILTIN_SKILL_TARGETS = [
  { id: "claude", label: "Claude Code", path: "~/.claude/skills" },
  { id: "codex", label: "Codex", path: "~/.codex/skills" },
  { id: "antigravity", label: "Antigravity", path: "~/.gemini/config/skills" },
] as const;

export const DEFAULT_SKILL_TARGET_PATHS: readonly string[] = BUILTIN_SKILL_TARGETS.map(
  (t) => t.path,
);

/** Normalize a skill target path (trim whitespace and trailing slashes except root `/`). */
export function normalizeSkillTargetPath(targetPath: string): string {
  const trimmed = targetPath.trim();
  if (trimmed === "/" || trimmed === "~") return trimmed;
  return trimmed.replace(/\/+$/, "");
}

// ─── Plugin Manifest (dovepaw-plugin.json in the plugin repo) ─────────────────

export const pluginManifestSchema = z.object({
  /** kebab-case plugin identifier — must be unique across installed plugins */
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "Must be kebab-case"),
  version: z.string(),
  /** Names of agents this plugin provides (must match agents/{name}/ directories) */
  agents: z.array(z.string()),
  /** Names of skills this plugin provides (must match skills/{name}/ directories) */
  skills: z.array(z.string()).optional().default([]),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

// ─── Plugin Record (entry in ~/.dovepaw/plugins.json) ─────────────────────────

export const pluginRecordSchema = z.object({
  /** kebab-case plugin name from its manifest */
  name: z.string(),
  /** Absolute path to the plugin directory on disk */
  path: z.string(),
  /** Git remote URL, if the plugin was installed from a remote */
  gitUrl: z.string().optional(),
  /** ISO 8601 timestamp of when the plugin was first installed */
  installedAt: z.string(),
  /** Semantic version from dovepaw-plugin.json, updated on every sync/update */
  version: z.string().optional(),
  /** Names of agents this plugin provides (kept in sync via sync/update) */
  agentNames: z.array(z.string()),
  /** Names of skills this plugin provides (kept in sync via sync/update) */
  skillNames: z.array(z.string()).optional().default([]),
  /**
   * Optional list of target directories where this plugin's skills are symlinked
   * (e.g. "~/.claude/skills", "~/.gemini/config/skills", or an absolute path).
   * When omitted, defaults to all built-in targets. An empty array disables skill symlinking.
   */
  skillTargets: z.array(z.string().min(1)).optional(),
});

export type PluginRecord = z.infer<typeof pluginRecordSchema>;

/** Return effective skill symlink target paths for a plugin (falls back to built-in defaults when unset). */
export function resolvePluginSkillTargets(plugin: Pick<PluginRecord, "skillTargets">): string[] {
  return plugin.skillTargets ?? [...DEFAULT_SKILL_TARGET_PATHS];
}

// ─── Plugins Registry (~/.dovepaw/plugins.json) ───────────────────────────────

export const pluginsRegistrySchema = z.object({
  version: z.literal(1),
  plugins: z.array(pluginRecordSchema),
});

export type PluginsRegistry = z.infer<typeof pluginsRegistrySchema>;
