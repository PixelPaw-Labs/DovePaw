import { Entry } from "@napi-rs/keyring";

/**
 * Keychain service names — one namespace per scope, with the env var name as the
 * account inside it.
 *
 * Every writer (the settings routes) and every reader (`env-resolver.ts`) must
 * derive the service from these helpers. They used to be private copies inside
 * each route file while the resolver defaulted to `DOVEPAW_SERVICE`, so
 * agent- and group-scoped secrets were written to one service and looked up in
 * another — they resolved to `undefined` and vanished from the agent's env.
 */
export const DOVEPAW_SERVICE = "dovepaw";
export const agentKeychainService = (agentName: string) => `dovepaw-agent-${agentName}`;
export const groupKeychainService = (groupName: string) => `dovepaw-group-${groupName}`;

export function getSecret(service: string, account: string): string | null {
  try {
    return new Entry(service, account).getPassword();
  } catch {
    return null;
  }
}

export function setSecret(service: string, account: string, value: string): void {
  new Entry(service, account).setPassword(value);
}

export function deleteSecret(service: string, account: string): void {
  try {
    new Entry(service, account).deletePassword();
  } catch {
    // not found — nothing to delete
  }
}
