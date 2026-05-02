/**
 * Ports manifest — read/write the .ports.json file that A2A servers write on startup.
 *
 * Extracted from base-server.ts so Next.js routes can import this without pulling
 * in the executor chain (QueryAgentExecutor → @anthropic-ai/claude-agent-sdk).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { PORTS_FILE } from "@/lib/paths";

export const portsManifestSchema = z.object({ updatedAt: z.string() }).catchall(z.number());

export interface PortsManifest {
  updatedAt: string;
  [key: string]: number | string;
}

export function writePortsManifest(ports: Record<string, number>): void {
  const manifest: PortsManifest = { ...ports, updatedAt: new Date().toISOString() };
  mkdirSync(dirname(PORTS_FILE), { recursive: true });
  writeFileSync(PORTS_FILE, JSON.stringify(manifest, null, 2));
}

export function readPortsManifest(): PortsManifest | null {
  if (!existsSync(PORTS_FILE)) return null;
  try {
    const parsed = portsManifestSchema.safeParse(JSON.parse(readFileSync(PORTS_FILE, "utf-8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
