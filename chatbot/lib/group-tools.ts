import { tool } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { consola } from "consola";
import type { AgentDef } from "@@/lib/agents";
import type { AgentGroup, AgentLink } from "@@/lib/agent-links-schemas";
import { GROUP_WORKSPACE_ROOT } from "@@/lib/paths";
import { z } from "zod";
import type { CollectedStream } from "@/lib/a2a-client";
import { TaskPoller } from "@/lib/task-poller";
import type { PendingRegistry } from "@/lib/pending-registry";
import { doveAwaitToolName } from "@/lib/query-tools";
import { withStartReminder } from "@@/lib/subagent-reminder";
import { GroupStartTopology } from "@/lib/group-topology";
import { getMemoryProvider } from "@/lib/memory";
import { publishSessionEvent } from "@/lib/session-events";
import { upsertSession, setActiveSession } from "@/lib/db";
import { groupMemberCounters } from "@/lib/group-member-counter";
import type { GroupMeta } from "@/lib/group-meta";

// ─── Group tool name helpers ──────────────────────────────────────────────────

/** Tool name for starting all members of a group. */
export const doveStartGroupToolName = (groupName: string) =>
  `start_group_${groupName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;

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
  const topology = new GroupStartTopology(group.name, groupLinks);
  const preferred = topology.preferred(memberDefs);
  const candidates = preferred.length > 0 ? preferred : topology.fallback(memberDefs);
  const buckets = renderMembers(candidates);
  const candidateRule =
    preferred.length > 0
      ? "Pick only from the agents listed above. Do not use any other agents."
      : "Pick only from the agents listed above. Never propose any agent not listed.";

  return tool(
    doveStartGroupToolName(group.name),
    `Initialize the "${group.name}" group and start the most relevant members. Each member gets a short WHAT-only instruction (1–2 sentences). Returns groupContextId and memberTaskIds — call \`await_<memberManifestKey>\` for each, passing the matching taskId and the groupContextId.`,
    {
      groupOrchestrationScore: z
        .number()
        .min(0)
        .max(100)
        .describe(
          "Orchestration behaviour score (0–100, must be >= 80): is dispatching this agent NOW the right decision per group-orchestrator-rules?\n" +
            "Not a handoff justification score (justification.confidence measures handoff quality).",
        ),
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
                "One or two sentences: WHAT this member should produce or decide — nothing else. " +
                  "DO NOT name other group members. DO NOT prescribe tools, search steps, or workflow. " +
                  "DO NOT describe the group process. The agent's persona handles HOW; you only state WHAT.",
              ),
          }),
        )
        .min(1)
        .max(3)
        .describe(
          `Pick 1–3 agents from the list below. Score each 0–100 for relevance. If no agent scores ≥ ${GROUP_MEMBER_RELEVANCE_THRESHOLD}, do NOT call this tool — stop immediately.\n${candidateRule}\n${buckets}`,
        ),
    },
    async ({ members: proposedMembers }) => {
      const groupContextId = randomUUID();
      const slug = doveStartGroupToolName(group.name).replace("start_group_", "");
      const groupMomentsPath = join(
        GROUP_WORKSPACE_ROOT,
        `${slug}-${groupContextId.replace(/-/g, "").slice(0, 8)}`,
      );

      try {
        const provider = await getMemoryProvider();
        await provider.init(groupContextId, groupMomentsPath);
      } catch (err) {
        consola.warn("Memory provider init failed; falling back to .md moments:", err);
        await mkdir(join(groupMomentsPath, "moments"), { recursive: true });
      }

      const knownDefs = group.members
        .map((name) => memberDefs.find((d) => d.name === name))
        .filter((d): d is AgentDef => d !== undefined);
      await mkdir(join(groupMomentsPath, "members"), { recursive: true });
      const rosterLines = [
        "# Group Members",
        "",
        "Only collaborate with, assign work to, or communicate with the agents listed below.",
        "Do not involve any agent outside this list.",
        "",
        ...knownDefs.map((d) => `- **${d.displayName}** (\`${d.name}\`): ${d.description}`),
        ...(knownDefs.length === 0 ? group.members.map((name) => `- \`${name}\``) : []),
      ];
      await writeFile(join(groupMomentsPath, "members", "roster.md"), rosterLines.join("\n"));

      upsertSession({
        id: groupContextId,
        agentId: `group:${group.name}`,
        startedAt: new Date().toISOString(),
        label: `Group: ${group.name}`,
        messages: [],
        progress: [],
        status: "running",
        workspacePath: groupMomentsPath,
      });
      setActiveSession(`group:${group.name}`, groupContextId);

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
        groupMomentsPath,
        groupContextId,
        groupName: group.name,
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

          // Signal that this member has been dispatched — transitions to "running"
          // once the A2A server accepts the task and returns a taskId.
          publishSessionEvent(groupContextId, {
            type: "agent_status",
            agentKey: memberDef.manifestKey,
            id: memberDef.manifestKey,
            status: "start",
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
