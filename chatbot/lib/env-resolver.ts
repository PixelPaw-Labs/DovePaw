/**
 * Resolves settings env vars into a plain Record<string, string> ready to be
 * merged into process.env before spawning a sub-agent or child process.
 *
 * - Plain vars: use value directly (excluded when value is empty string).
 * - Secret vars: read from OS keychain; excluded when not found.
 */

import { getSecret, DOVEPAW_SERVICE, agentKeychainService } from "@/lib/keyring";
import type { GlobalSettings, EnvVar, AgentSettings } from "@@/lib/settings-schemas";

/**
 * @param fallbackService - Keychain service to read from when the var is not a
 *   link to another app's entry. Must match the service the corresponding
 *   settings route writes under, or the secret silently resolves to undefined.
 */
function resolveEnvVar(envVar: EnvVar, fallbackService: string): string | undefined {
  if (!envVar.isSecret) {
    return envVar.value !== "" ? envVar.value : undefined;
  }
  const service = envVar.keychainService ?? fallbackService;
  const account = envVar.keychainAccount ?? envVar.key;
  const secret = getSecret(service, account);
  return secret !== null && secret !== "" ? secret : undefined;
}

/**
 * Resolves a standalone list of env vars — used for group vars, whose secrets
 * live under `groupKeychainService(groupName)`.
 */
export function resolveEnvVarList(
  envVars: EnvVar[],
  fallbackService: string = DOVEPAW_SERVICE,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const envVar of envVars) {
    const value = resolveEnvVar(envVar, fallbackService);
    if (value !== undefined) env[envVar.key] = value;
  }
  return env;
}

/**
 * Global settings vars, then per-agent vars layered on top.
 *
 * `agentName` is required whenever agent vars are passed: their secrets live
 * under that agent's own keychain service, not the global one.
 */
export function resolveSettingsEnv(settings: GlobalSettings): Record<string, string>;
export function resolveSettingsEnv(
  settings: GlobalSettings,
  agentEnvVars: AgentSettings["envVars"],
  agentName: string,
): Record<string, string>;
export function resolveSettingsEnv(
  settings: GlobalSettings,
  agentEnvVars: AgentSettings["envVars"] = [],
  agentName?: string,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const envVar of settings.envVars) {
    const value = resolveEnvVar(envVar, DOVEPAW_SERVICE);
    if (value !== undefined) env[envVar.key] = value;
  }

  const agentService = agentName ? agentKeychainService(agentName) : DOVEPAW_SERVICE;
  for (const envVar of agentEnvVars) {
    const value = resolveEnvVar(envVar, agentService);
    if (value !== undefined) env[envVar.key] = value;
  }

  return env;
}
