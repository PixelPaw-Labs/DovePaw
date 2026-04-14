/** Zod schemas for the DovePaw plugin system. No Node.js imports — safe in client components. */
import { z } from "zod";

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
  /** Names of agents this plugin provides (kept in sync via sync/update) */
  agentNames: z.array(z.string()),
  /** Names of skills this plugin provides (kept in sync via sync/update) */
  skillNames: z.array(z.string()).optional().default([]),
});

export type PluginRecord = z.infer<typeof pluginRecordSchema>;

// ─── Plugins Registry (~/.dovepaw/plugins.json) ───────────────────────────────

export const pluginsRegistrySchema = z.object({
  version: z.literal(1),
  plugins: z.array(pluginRecordSchema),
});

export type PluginsRegistry = z.infer<typeof pluginsRegistrySchema>;
