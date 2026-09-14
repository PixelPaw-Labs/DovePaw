import { keepAwake } from "pervigil";

/**
 * Holds a system sleep lock for the duration of `fn` so a long-running agent
 * invocation survives the host going to sleep mid-call. Degrades to a silent
 * no-op on unsupported platforms (pervigil's default, non-strict behaviour).
 */
export function withKeepAwake<T>(description: string, fn: () => Promise<T>): Promise<T> {
  return keepAwake.while({ system: true, description }, fn);
}
