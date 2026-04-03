/**
 * Resolves settings env vars into a plain Record<string, string> ready to be
 * merged into process.env before spawning a sub-agent or child process.
 *
 * - Plain vars: use value directly (excluded when value is empty string).
 * - Secret vars: read from OS keychain; excluded when not found.
 */

import { getSecret, DOVEPAW_SERVICE } from "@/lib/keyring";
import type { GlobalSettings, EnvVar, AgentSettings } from "@@/lib/settings-schemas";

function resolveEnvVar(envVar: EnvVar): string | undefined {
  if (!envVar.isSecret) {
    return envVar.value !== "" ? envVar.value : undefined;
  }
  const service = envVar.keychainService ?? DOVEPAW_SERVICE;
  const account = envVar.keychainAccount ?? envVar.key;
  const secret = getSecret(service, account);
  return secret !== null && secret !== "" ? secret : undefined;
}

export function resolveSettingsEnv(
  settings: GlobalSettings,
  agentEnvVars: AgentSettings["envVars"] = [],
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const envVar of settings.envVars) {
    const value = resolveEnvVar(envVar);
    if (value !== undefined) env[envVar.key] = value;
  }

  for (const envVar of agentEnvVars) {
    const value = resolveEnvVar(envVar);
    if (value !== undefined) env[envVar.key] = value;
  }

  return env;
}
