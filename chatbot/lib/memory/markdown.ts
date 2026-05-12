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
  async initGroup(_groupContextId: string, workspacePath: string): Promise<void> {
    await mkdir(join(workspacePath, "moments"), { recursive: true });
  }

  async deleteGroup(_groupContextId: string, workspacePath: string): Promise<void> {
    await rm(join(workspacePath, "moments"), { recursive: true, force: true });
  }

  buildReminder(workspacePath: string, _groupContextId: string): string {
    return `You are participating in a group task. Before starting:
${rosterBullet(workspacePath)}
- Read ${workspacePath}/moments/ to understand what other agents have already decided or produced.
- Save to ${workspacePath}/moments/ when: decision reached, artifact complete, insight worth sharing.
  Writing style:
${indentedMomentsPattern()}`;
  }
}
