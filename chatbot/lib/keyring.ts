import { Entry } from "@napi-rs/keyring";

export const DOVEPAW_SERVICE = "dovepaw";

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
