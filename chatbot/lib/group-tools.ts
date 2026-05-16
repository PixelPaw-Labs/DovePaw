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
import { doveAwaitToolName } from "@/lib/query-tools";
import { withStartReminder } from "@@/lib/subagent-reminder";
import { cloneReposIntoWorkspace } from "@/a2a/lib/workspace";
import { getMemoryProvider } from "@/lib/memory";
import { publishSessionEvent } from "@/lib/session-events";
import { upsertSession, setActiveSession } from "@/lib/db";
import { groupMemberCounters } from "@/lib/group-member-counter";
import type { GroupMeta } from "@/lib/group-meta";

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
      `Initialize a shared workspace for the "${group.name}" group, then delegate work to members using start_group_*.`,
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

const renderMembers = (defs: AgentDef[]) =>
  defs.map((d) => `- ${d.name}: ${d.description}`).join("\n");

/**
 * Fans out the instruction to all relevant members of the group.
 *
 * Each dispatched member is registered in `groupMemberCounters` so the
 * matching `await_<memberKey>` call (with groupContextId in its input)
 * can fire the group "done" event when the last member completes.
 *
 * Returns memberTaskIds (manifestKey → taskId) — Dove passes each one to the
 * corresponding `await_<memberKey>` together with the groupContextId.
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
  const buckets =
    preferred.length > 0
      ? renderMembers(preferred)
      : fallback.length > 0
        ? renderMembers(fallback)
        : "";
  const candidateRule =
    preferred.length > 0
      ? "Pick only from the agents listed above. Do not use any other agents."
      : "Pick only from the agents listed above. Never propose any agent not listed.";

  return tool(
    doveStartGroupToolName(group.name),
    `Start the most relevant members of the "${group.name}" group, each with a tailored instruction. Returns memberTaskIds — call \`await_<memberManifestKey>\` for each, passing the matching taskId and the groupContextId.`,
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
                "Instruction scoped to THIS member's specialty — not the whole task. Must open with: 'Orchestrator:' followed by the slice this member should own.",
              ),
          }),
        )
        .min(1)
        .max(3)
        .describe(
          `Pick 1–3 agents from the list below. Score each 0–100 for relevance. If no agent scores ≥ ${GROUP_MEMBER_RELEVANCE_THRESHOLD}, do NOT call this tool — stop immediately.\n${candidateRule}\n${buckets}`,
        ),
      groupWorkspacePath: z.string().describe("groupWorkspacePath from init_group_* result"),
      groupContextId: z.string().describe("groupContextId from init_group_* result"),
      groupName: z.string().describe("groupName from init_group_* result"),
    },
    async ({ members: proposedMembers, groupWorkspacePath, groupContextId, groupName }) => {
      const ranked = proposedMembers.toSorted((a, b) => b.relevanceScore - a.relevanceScore);
      const dispatched = ranked
        .filter((m) => m.relevanceScore >= GROUP_MEMBER_RELEVANCE_THRESHOLD)
        .slice(0, 3);
      if (dispatched.length === 0) {
        return {
          content: [
            { type: "text" as const, text: "No members scored above threshold — stopping." },
          ],
          structuredContent: { memberTaskIds: {}, groupContextId },
        };
      }
      const groupMeta: GroupMeta = {
        isGroupChat: true,
        groupWorkspacePath,
        groupContextId,
        groupName,
      };
      const memberTaskIds: Record<string, string> = {};

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

          const result = await new TaskPoller(
            memberDef.manifestKey,
            memberDef.displayName,
            signal,
            registry,
            doveAwaitToolName(memberDef),
            memberDef.name,
          ).start(withStartReminder(member.instruction, memberDef.manifestKey), {
            backgroundTasks,
            senderAgentId: "dove",
            extraMetadata: groupMeta,
            groupSource: "group",
          });
          const taskId = (result.structuredContent as { taskId?: string } | undefined)?.taskId;
          if (taskId) {
            publishSessionEvent(groupContextId, {
              type: "agent_status",
              agentKey: memberDef.manifestKey,
              id: taskId,
              status: "running",
            });
            memberTaskIds[memberDef.manifestKey] = taskId;
            // Register this member in the group completion counter so the matching
            // `await_<memberKey>(groupContextId=…)` call fires the group "done"
            // event when the last member resolves.
            const counter = groupMemberCounters.get(groupContextId) ?? {
              started: 0,
              completed: 0,
            };
            counter.started += 1;
            groupMemberCounters.set(groupContextId, counter);
          }
        }),
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Group "${group.name}" started (${Object.keys(memberTaskIds).length} members). Call \`await_<memberKey>\` for each (with groupContextId) to collect results.`,
          },
        ],
        structuredContent: { memberTaskIds, groupContextId },
      };
    },
  );
}
