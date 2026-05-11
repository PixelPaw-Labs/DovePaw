import { tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDef } from "@@/lib/agents";
import type { AgentGroup } from "@@/lib/agent-links-schemas";
import { GROUP_WORKSPACE_ROOT } from "@@/lib/paths";
import { readSettings } from "@@/lib/settings";
import { readOrCreateGroupConfig } from "@@/lib/group-config";
import { z } from "zod";
import type { CollectedStream } from "@/lib/a2a-client";
import { TaskPoller } from "@/lib/task-poller";
import type { PendingRegistry } from "@/lib/pending-registry";
import { taskRuntime } from "@/lib/task-runtime";
import { doveAwaitToolName } from "@/lib/query-tools";
import { withStartReminder } from "@@/lib/subagent-reminder";
import { cloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import { publishSessionEvent } from "@/lib/session-events";
import { upsertSession, setActiveSession, setGroupMessage, setSessionStatus } from "@/lib/db";

// ─── Group tool name helpers ──────────────────────────────────────────────────

/** Slugified group name used as the `init_group_*` MCP tool name. */
export const doveInitGroupToolName = (groupName: string) =>
  `init_group_${groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
/** Tool name for starting all members of a group. */
export const doveStartGroupToolName = (groupName: string) =>
  `start_group_${groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
/** Tool name for awaiting all members of a group. */
export const doveAwaitGroupToolName = (groupName: string) =>
  `await_group_${groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;

// ─── makeInitGroupTool ────────────────────────────────────────────────────────

/**
 * Creates the shared group workspace (moments/) and clones
 * group repos into it. Returns the workspace path and context ID so Dove can
 * pass them to start_group_* calls.
 */
export function makeInitGroupTool(group: AgentGroup, memberDefs: AgentDef[]) {
  return tool(
    doveInitGroupToolName(group.name),
    [
      `Initialize a shared workspace for the "${group.name}" group, then delegate work to members using start_group_* tools.`,
      group.description && `Group focus: ${group.description}`,
      `Members: ${group.members.join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
    {},
    async () => {
      const groupContextId = randomUUID();
      const slug = doveInitGroupToolName(group.name).replace("init_group_", "");
      const groupWorkspacePath = join(
        GROUP_WORKSPACE_ROOT,
        `${slug}-${groupContextId.replace(/-/g, "").slice(0, 8)}`,
      );
      await mkdir(join(groupWorkspacePath, "moments"), { recursive: true });

      // Write the member roster so every agent knows who is in this group
      const knownDefs = group.members
        .map((name) => memberDefs.find((d) => d.name === name))
        .filter((d): d is AgentDef => d !== undefined);
      await mkdir(join(groupWorkspacePath, "members"), { recursive: true });
      const rosterLines = [
        "# Group Members",
        "",
        "Only collaborate with, assign work to, or communicate with the agents listed below.",
        "Do not involve any agent outside this list.",
        "",
        ...knownDefs.map((d) => `- **${d.displayName}** (\`${d.name}\`): ${d.description}`),
        ...(knownDefs.length === 0 ? group.members.map((name) => `- \`${name}\``) : []),
      ];
      await writeFile(join(groupWorkspacePath, "members", "roster.md"), rosterLines.join("\n"));

      const settings = await readSettings();
      const groupConfig = readOrCreateGroupConfig(group.name);
      const repoSlugs = groupConfig.repos
        .map((id) => settings.repositories.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => r.githubRepo);

      if (repoSlugs.length > 0) {
        await cloneReposIntoWorkspace(groupWorkspacePath, repoSlugs);
      }

      upsertSession({
        id: groupContextId,
        agentId: `group:${group.name}`,
        startedAt: new Date().toISOString(),
        label: `Group: ${group.name}`,
        messages: [],
        progress: [],
        status: "running",
      });
      setActiveSession(`group:${group.name}`, groupContextId);

      return {
        content: [
          {
            type: "text" as const,
            text: `Group "${group.name}" workspace ready. Now call start_group_* for each relevant member.`,
          },
        ],
        structuredContent: { groupWorkspacePath, groupContextId, groupName: group.name },
      };
    },
  );
}

// ─── makeStartGroupTool ───────────────────────────────────────────────────────

/**
 * Fans out the instruction to all online members of the group.
 * Returns memberTaskIds (manifestKey → taskId) to pass to await_group_*.
 */
export function makeStartGroupTool(
  group: AgentGroup,
  memberDefs: AgentDef[],
  signal?: AbortSignal,
  backgroundTasks?: Promise<CollectedStream>[],
  registry?: PendingRegistry,
) {
  return tool(
    doveStartGroupToolName(group.name),
    `Start all members of the "${group.name}" group on a task. Returns memberTaskIds to pass to ${doveAwaitGroupToolName(group.name)}.`,
    {
      instruction: z
        .string()
        .describe(
          "Instruction for the group. Must open with: 'I am Dove, your orchestrator. ' followed by the task.",
        ),
      members: z
        .array(z.string())
        .min(1)
        .max(3)
        .describe(
          `1–3 member names to delegate to. Choose the most relevant.\n<members>\n${memberDefs.map((d) => `  <member name="${d.name}">${d.description}</member>`).join("\n")}\n</members>`,
        ),
      groupWorkspacePath: z.string().describe("groupWorkspacePath from init_group_* result"),
      groupContextId: z.string().describe("groupContextId from init_group_* result"),
      groupName: z.string().describe("groupName from init_group_* result"),
    },
    async ({ instruction, members, groupWorkspacePath, groupContextId, groupName }) => {
      const groupMeta = { isGroupChat: true, groupWorkspacePath, groupContextId, groupName };
      const memberTaskIds: Record<string, string> = {};
      const allMemberDrains: Promise<CollectedStream>[] = [];

      // One sender bubble for Dove's instruction — shown before any member responds.
      publishSessionEvent(groupContextId, {
        type: "group_member",
        agentId: "dove",
        text: instruction,
        done: true,
        isSender: true,
      });

      await Promise.all(
        members.map(async (memberName) => {
          const memberDef = memberDefs.find((a) => a.name === memberName);
          if (!memberDef) return;
          // Per-member drain bucket — captures the stream promise so we can
          // publish the final group_member event from this (Next.js) process.
          // Streaming progress events are handled by the A2A dispatcher's groupRelay path.
          const memberDrain: Promise<CollectedStream>[] = [];
          const result = await new TaskPoller(
            memberDef.manifestKey,
            memberDef.displayName,
            signal,
            registry,
            doveAwaitGroupToolName(group.name),
            memberDef.name,
          ).start(withStartReminder(instruction, memberDef.manifestKey), {
            backgroundTasks: memberDrain,
            senderAgentId: "dove",
            extraMetadata: groupMeta,
          });
          const taskId = (result.structuredContent as { taskId?: string } | undefined)?.taskId;
          if (taskId) {
            memberTaskIds[memberDef.manifestKey] = taskId;
            if (backgroundTasks) backgroundTasks.push(...memberDrain);
            allMemberDrains.push(...memberDrain);
            if (memberDrain.length > 0) {
              void memberDrain[0].then((collected) => {
                setGroupMessage(taskId, collected.result.output);
              });
            }
          }
        }),
      );

      // Close the group context after all member drains (including cascading
      // member-to-member handoffs) have settled. This triggers the session-events
      // TTL and marks the group session done in the DB.
      if (allMemberDrains.length > 0) {
        void Promise.allSettled(allMemberDrains).then(() => {
          publishSessionEvent(groupContextId, { type: "done" });
          setSessionStatus(groupContextId, "done");
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Group "${group.name}" started (${Object.keys(memberTaskIds).length} members). Call ${doveAwaitGroupToolName(group.name)} to collect results.`,
          },
        ],
        structuredContent: { memberTaskIds, groupContextId },
      };
    },
  );
}

// ─── makeAwaitGroupTool ───────────────────────────────────────────────────────

/**
 * Polls all member tasks started by start_group_*. Returns combined output when
 * all complete, or { status: "still_running", memberTaskIds } for re-polling.
 */
export function makeAwaitGroupTool(
  group: AgentGroup,
  memberDefs: AgentDef[],
  signal?: AbortSignal,
  registry?: PendingRegistry,
) {
  return tool(
    doveAwaitGroupToolName(group.name),
    `Await all members of the "${group.name}" group. Re-call with the same memberTaskIds if still_running.`,
    {
      memberTaskIds: z
        .record(z.string(), z.string())
        .describe("memberTaskIds from start_group_* result"),
      groupContextId: z.string().describe("groupContextId from start_group_* result"),
      timeoutMs: z
        .number()
        .int()
        .min(10000)
        .describe(
          taskRuntime.buildGroupDescription(
            memberDefs.map((d) => ({ agentName: d.name, toolName: doveAwaitToolName(d) })),
          ),
        ),
    },
    async ({ memberTaskIds, groupContextId, timeoutMs }) => {
      const entries = Object.entries(memberTaskIds);
      const results = await Promise.all(
        entries.map(([manifestKey, taskId]) => {
          const memberDef = memberDefs.find((a) => a.manifestKey === manifestKey);
          return new TaskPoller(
            manifestKey,
            memberDef?.displayName ?? manifestKey,
            signal,
            registry,
            doveAwaitGroupToolName(group.name),
            memberDef?.name,
          ).poll(taskId, timeoutMs);
        }),
      );

      const updatedIds: Record<string, string> = {};
      let anyStillRunning = false;
      for (let i = 0; i < entries.length; i++) {
        const [key] = entries[i];
        const sc = results[i].structuredContent as { status?: string; taskId?: string } | undefined;
        if (sc?.status === "still_running" && sc.taskId) {
          updatedIds[key] = sc.taskId;
          anyStillRunning = true;
        } else {
          updatedIds[key] = memberTaskIds[key];
        }
      }

      if (anyStillRunning) {
        return {
          content: [{ type: "text" as const, text: "Group still running. Re-call to poll." }],
          structuredContent: { status: "still_running", memberTaskIds: updatedIds, groupContextId },
        };
      }

      const combinedText = results
        .map((r, i) => `[${entries[i][0]}]: ${r.content?.[0]?.text ?? ""}`)
        .join("\n\n");
      return {
        content: [{ type: "text" as const, text: combinedText }],
        structuredContent: {
          memberResults: Object.fromEntries(entries.map(([k], i) => [k, results[i]])),
          groupContextId,
        },
      };
    },
  );
}
