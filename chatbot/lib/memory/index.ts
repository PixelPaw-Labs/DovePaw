/**
 * Memory provider registry.
 *
 * Resolution order in `getMemoryProvider()`:
 *   1. In-memory override (set by Next.js instrumentation after a successful
 *      sidecar boot, or by tests).
 *   2. Disk lookup — if `OPENVIKING_PORT_FILE` exists and contains a valid
 *      port, return an `OpenVikingMemoryProvider` bound to that port. This is
 *      how the A2A process discovers the Next.js-owned sidecar.
 *   3. Fallback to `MarkdownMemoryProvider`.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { consola } from "consola";
import { OPENVIKING_PORT_FILE } from "@@/lib/paths";
import type { MemoryProvider } from "./types";
import { MarkdownMemoryProvider } from "./markdown";
import { OpenVikingMemoryProvider } from "./openviking";

const portFileSchema = z.object({ port: z.number().int().positive() });

let override: MemoryProvider | null = null;

export async function getMemoryProvider(): Promise<MemoryProvider> {
  if (override) return override;
  try {
    const { port } = portFileSchema.parse(
      JSON.parse(await readFile(OPENVIKING_PORT_FILE, "utf-8")),
    );
    return new OpenVikingMemoryProvider(port);
  } catch (err) {
    const codeVal = err instanceof Error && "code" in err ? err.code : undefined;
    const code = typeof codeVal === "string" ? codeVal : undefined;
    if (code !== "ENOENT") {
      consola.warn("OpenViking port file unreadable, falling back to .md moments:", err);
    }
    return new MarkdownMemoryProvider();
  }
}

/**
 * Install or clear an in-process override. Used by the Next.js instrumentation
 * hook (to hold a live provider with a ChildProcess handle) and by tests.
 * Pass `null` to clear the override and re-enable disk-based resolution.
 */
export function setMemoryProvider(provider: MemoryProvider | null): void {
  override = provider;
}
