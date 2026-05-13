import { tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";
import type { AgentDef } from "@@/lib/agents";
import type { AgentGroup, AgentLink } from "@@/lib/agent-links-schemas";
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
import { getMemoryProvider } from "@/lib/memory";
import { publishSessionEvent } from "@/lib/session-events";
import { upsertSession, setActiveSession, setGroupMessage, setSessionStatus } from "@/lib/db";
import { markGroupTaskDone, pendingGroupTasks } from "@/lib/group-task-store";

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

      // Bootstrap per-group memory state via the active provider. On any
      // failure fall back to the MarkdownMemoryProvider so the group still
      // works on disk.
      try {
        const provider = await getMemoryProvider();
        await provider.initGroup(groupContextId, groupWorkspacePath);
      } catch (err) {
        consola.warn("Memory provider initGroup failed; falling back to .md moments:", err);
        await mkdir(join(groupWorkspacePath, "moments"), { recursive: true });
      }

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

      // Persist the session row BEFORE any I/O that can fail (clone). If a
      // clone errors the row still exists so the UI can render the failed
      // group instead of silently dropping it. Same reasoning for activeSession.
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

      const settings = await readSettings();
      const groupConfig = readOrCreateGroupConfig(group.name);
      const repoSlugs = groupConfig.repos
        .map((id) => settings.repositories.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => r.githubRepo);

      if (repoSlugs.length > 0) {
        await cloneReposIntoWorkspace(groupWorkspacePath, repoSlugs);
      }

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

/** Minimum relevance score (0-100) for a candidate member to be dispatched. */
const GROUP_MEMBER_RELEVANCE_THRESHOLD = 90;

const renderMemberXml = (defs: AgentDef[]) =>
  defs.map((d) => `  <member name="${d.name}">${d.description}</member>`).join("\n");

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
  groupLinks: AgentLink[] = [],
) {
  // Eligibility from the group's link subgraph: only links where the link's
  // `group` matches this group count. A dual-direction edge contributes both
  // out-degree and in-degree to each endpoint.
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const l of groupLinks) {
    if (l.group !== group.name) continue;
    outDeg.set(l.source, (outDeg.get(l.source) ?? 0) + 1);
    inDeg.set(l.target, (inDeg.get(l.target) ?? 0) + 1);
    if (l.direction === "dual") {
      outDeg.set(l.target, (outDeg.get(l.target) ?? 0) + 1);
      inDeg.set(l.source, (inDeg.get(l.source) ?? 0) + 1);
    }
  }
  const preferred = memberDefs.filter(
    (d) => (outDeg.get(d.name) ?? 0) > 0 && (inDeg.get(d.name) ?? 0) === 0,
  );
  const fallback = memberDefs.filter(
    (d) => (outDeg.get(d.name) ?? 0) === 0 && (inDeg.get(d.name) ?? 0) === 0,
  );
  const buckets = [
    preferred.length > 0 && `<preferred>\n${renderMemberXml(preferred)}\n</preferred>`,
    fallback.length > 0 && `<fallback>\n${renderMemberXml(fallback)}\n</fallback>`,
  ]
    .filter(Boolean)
    .join("\n");
  const candidateRule =
    preferred.length > 0 && fallback.length > 0
      ? "Pick from <preferred> first. Only include <fallback> entries to fill remaining slots within the 1–3 cap when <preferred> alone is insufficient. Never propose any agent not listed below."
      : "Pick only from the agents listed below. Never propose any agent not listed.";

  return tool(
    doveStartGroupToolName(group.name),
    `Start the most relevant members of the "${group.name}" group, each with a tailored instruction. Returns memberTaskIds to pass to ${doveAwaitGroupToolName(group.name)}.`,
    {
      members: z
        .array(
          z.object({
            name: z.string().describe("Member agent name from the roster below."),
            relevanceScore: z
              .number()
              .int()
              .min(0)
              .max(100)
              .describe(
                `Relevance to this task (0-100). Only candidates scoring ≥ ${GROUP_MEMBER_RELEVANCE_THRESHOLD} are dispatched.`,
              ),
            instruction: z
              .string()
              .describe(
                "Instruction scoped to THIS member's specialty — not the whole task. Must open with: 'I am Dove, your orchestrator. ' followed by the slice this member should own.",
              ),
          }),
        )
        .min(1)
        .max(3)
        .describe(
          `Propose up to 3 candidate members, each with a relevance score (0-100) AND a tailored instruction scoped to that member's specialty. Be selective: only candidates scoring ≥ ${GROUP_MEMBER_RELEVANCE_THRESHOLD} are dispatched, so the final count may be 1, 2, or 3 — do not pad. Each instruction must describe only that member's slice of the work; if a piece crosses into another member's lane, that other member should be a separate entry with its own instruction.\n${candidateRule}\n<members>\n${buckets}\n</members>`,
        ),
      groupWorkspacePath: z.string().describe("groupWorkspacePath from init_group_* result"),
      groupContextId: z.string().describe("groupContextId from init_group_* result"),
      groupName: z.string().describe("groupName from init_group_* result"),
    },
    async ({ members: proposedMembers, groupWorkspacePath, groupContextId, groupName }) => {
      // Filter proposals by relevance score; fall back to the highest scorer
      // when nothing clears the threshold, so dispatch always has ≥1 member.
      const ranked = proposedMembers.toSorted((a, b) => b.relevanceScore - a.relevanceScore);
      const qualified = ranked
        .filter((m) => m.relevanceScore >= GROUP_MEMBER_RELEVANCE_THRESHOLD)
        .slice(0, 3);
      const dispatched = qualified.length > 0 ? qualified : ranked.slice(0, 1);
      const groupMeta = { isGroupChat: true, groupWorkspacePath, groupContextId, groupName };
      const memberTaskIds: Record<string, string> = {};
      const allMemberDrains: Promise<CollectedStream>[] = [];

      await Promise.all(
        dispatched.map(async (member) => {
          const memberDef = memberDefs.find((a) => a.name === member.name);
          if (!memberDef) return;

          // One sender bubble per member — Dove's tailored instruction to this agent.
          publishSessionEvent(groupContextId, {
            type: "group_member",
            agentId: "dove",
            text: `@${memberDef.displayName}\n\n${member.instruction}`,
            done: true,
            isSender: true,
          });

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
          ).start(withStartReminder(member.instruction, memberDef.manifestKey), {
            backgroundTasks: memberDrain,
            senderAgentId: "dove",
            extraMetadata: groupMeta,
            groupSource: "group",
          });
          const taskId = (result.structuredContent as { taskId?: string } | undefined)?.taskId;
          if (taskId) {
            memberTaskIds[memberDef.manifestKey] = taskId;
            if (backgroundTasks) backgroundTasks.push(...memberDrain);
            allMemberDrains.push(...memberDrain);
            if (memberDrain.length > 0) {
              void (async () => {
                try {
                  const collected = await memberDrain[0];
                  setGroupMessage(taskId, collected.result.output);
                  await markGroupTaskDone(taskId);
                } catch (err) {
                  consola.warn("group member drain cleanup failed:", err);
                }
              })();
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
    `Await all still-running tasks for the "${group.name}" group. Reads the live task list from the per-group ledger (keyed by groupContextId) — no memberTaskIds needed. Re-call with the same groupContextId if still_running.`,
    {
      groupContextId: z
        .string()
        .describe("groupContextId from init_group_* / start_group_* result"),
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
    async ({ groupContextId, timeoutMs }) => {
      const pending = await pendingGroupTasks(groupContextId);
      if (pending.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No pending tasks for group "${group.name}" — all done.`,
            },
          ],
          structuredContent: { status: "no_pending", groupContextId },
        };
      }

      const results = await Promise.all(
        pending.map((t) => {
          const memberDef = memberDefs.find((a) => a.manifestKey === t.memberKey);
          return new TaskPoller(
            t.memberKey,
            memberDef?.displayName ?? t.displayName,
            signal,
            registry,
            doveAwaitGroupToolName(group.name),
            memberDef?.name,
          ).poll(t.taskId, timeoutMs);
        }),
      );

      const anyStillRunning = results.some((r) => {
        const sc = r.structuredContent as { status?: string } | undefined;
        return sc?.status === "still_running";
      });

      if (anyStillRunning) {
        return {
          content: [{ type: "text" as const, text: "Group still running. Re-call to poll." }],
          structuredContent: { status: "still_running", groupContextId },
        };
      }

      const combinedText = results
        .map((r, i) => `[${pending[i].memberKey}]: ${r.content?.[0]?.text ?? ""}`)
        .join("\n\n");
      return {
        content: [{ type: "text" as const, text: combinedText }],
        structuredContent: {
          memberResults: Object.fromEntries(pending.map((t, i) => [t.memberKey, results[i]])),
          groupContextId,
        },
      };
    },
  );
}
