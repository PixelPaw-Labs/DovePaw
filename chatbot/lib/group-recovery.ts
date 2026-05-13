/**
 * Group pipeline gap recovery.
 *
 * Reads checkpoints and the agent link topology to detect agents that
 * completed without dispatching the expected downstream handoff, then
 * resumes each stalled session with a corrective prompt so it can
 * self-diagnose and issue the missing handoff.
 *
 * Intentionally separate from group-checkpoint.ts (pure data) to avoid
 * a circular import with task-poller.ts.
 */

import { consola } from "consola";
import type { AgentDef } from "@@/lib/agents";
import { readAgentLinks } from "@@/lib/agent-links";
import type { PendingRegistry } from "@/lib/pending-registry";
import { readGroupTaskRecord } from "@/lib/group-task-store";
import {
  readGroupGoal,
  readGroupCheckpoints,
  detectGaps,
  buildCorrectionPrompt,
  buildGroupGoalIntent,
} from "@/lib/group-checkpoint";
import { TaskPoller } from "@/lib/task-poller";

/**
 * Detects pipeline gaps for the given group context and re-dispatches each
 * stalled source agent with a corrective prompt.
 *
 * Returns the number of gaps recovered. Callers should return `still_running`
 * when the count is > 0 so Dove naturally re-polls until corrections settle.
 *
 * All errors are swallowed and logged — recovery failure must never crash the
 * await tool or block Dove from reporting a final result.
 */
export async function recoverGroupGaps({
  groupContextId,
  groupName,
  groupDescription,
  memberDefs,
  awaitToolName,
  signal,
  registry,
}: {
  groupContextId: string;
  groupName: string;
  groupDescription?: string;
  memberDefs: AgentDef[];
  /** The await_group_* tool name used to register corrections in the registry. */
  awaitToolName: string;
  signal?: AbortSignal;
  registry?: PendingRegistry;
}): Promise<number> {
  try {
    const record = await readGroupTaskRecord(groupContextId);
    const workspacePath = record?.groupWorkspacePath;
    if (!workspacePath) return 0;

    const [checkpoints, links, goal] = await Promise.all([
      readGroupCheckpoints(workspacePath),
      readAgentLinks(),
      readGroupGoal(workspacePath),
    ]);

    const gaps = detectGaps(checkpoints, record?.tasks ?? [], links, groupName);
    if (gaps.length === 0) return 0;

    const goalIntent = goal?.intent ?? buildGroupGoalIntent(groupName, groupDescription);

    const groupMeta = {
      isGroupChat: true,
      groupWorkspacePath: workspacePath,
      groupContextId,
      groupName,
    };

    await Promise.all(
      gaps.map((gap) => {
        const memberDef = memberDefs.find((d) => d.manifestKey === gap.sourceCheckpoint.memberKey);
        const displayName = memberDef?.displayName ?? gap.sourceCheckpoint.displayName;

        consola.info(
          `[group-recovery] Resuming ${gap.sourceCheckpoint.memberKey} (${gap.sourceCheckpoint.taskId}) — missing handoff to ${gap.expectedTargetKey}`,
        );

        const correctionPrompt = buildCorrectionPrompt(
          { ...gap, expectedTargetDisplayName: displayName },
          goalIntent,
        );

        return new TaskPoller(
          gap.sourceCheckpoint.memberKey,
          displayName,
          signal,
          registry,
          awaitToolName,
          memberDef?.name,
        ).start(correctionPrompt, {
          contextId: gap.sourceCheckpoint.contextId,
          senderAgentId: "dove",
          extraMetadata: groupMeta,
          groupSource: gap.source,
        });
      }),
    );

    return gaps.length;
  } catch (err) {
    consola.warn("[group-recovery] Gap detection failed (non-fatal):", err);
    return 0;
  }
}
