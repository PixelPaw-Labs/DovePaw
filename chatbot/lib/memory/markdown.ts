/**
 * Filesystem fallback memory provider.
 *
 * Used whenever a richer provider (OpenViking, future remote stores) is
 * unavailable — keeps group chat working with plain `moments/*.md` files
 * inside the shared group workspace.
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryProvider } from "./types";
import { indentedMomentsPattern, rosterBullet } from "./types";

export class MarkdownMemoryProvider implements MemoryProvider {
  async init(_contextId: string, workspacePath: string): Promise<void> {
    await mkdir(join(workspacePath, "moments"), { recursive: true });
  }

  async delete(_contextId: string, workspacePath: string): Promise<void> {
    await rm(join(workspacePath, "moments"), { recursive: true, force: true });
  }

  async buildReadReminder(workspacePath: string, _contextId: string): Promise<string> {
    return `- You MUST read ${workspacePath}/moments/ before acting. This is a hard requirement — do not skip it.`;
  }

  rosterReadReminder(workspacePath: string): string {
    return `You are participating in a group task. Before starting:\n${rosterBullet(workspacePath)}`;
  }

  buildSaveReminder(workspacePath: string): string {
    return `You MUST save moments (decisions, artifacts, insights) to ${workspacePath}/moments/ when: decision reached, artifact complete, insight worth sharing. This is a hard requirement — do not skip it.
  Writing style:
${indentedMomentsPattern()}`;
  }
}
