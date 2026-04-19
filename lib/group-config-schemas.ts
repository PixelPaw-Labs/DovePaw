/**
 * Zod schemas and derived types for per-group configuration.
 * No Node.js imports — safe to use in client components.
 */

import { z } from "zod";
import { envVarSchema } from "./settings-schemas";

export const groupConfigSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  /** Enabled repository UUIDs (from global settings.repositories). */
  repos: z.array(z.string()).default([]),
  /** Per-group environment variable overrides. */
  envVars: z.array(envVarSchema).default([]),
});

export type GroupConfig = z.infer<typeof groupConfigSchema>;
