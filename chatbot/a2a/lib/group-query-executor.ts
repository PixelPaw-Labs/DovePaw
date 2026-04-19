/**
 * A2A executor for a named group of agents.
 *
 * When triggered via ask_group_*, this executor:
 *   1. Loads group config (repos + env vars from ~/.dovepaw/settings.groups/<name>/)
 *   2. Creates a shared workspace with chat_histories/ and moments/
 *   3. Clones group repos into the workspace
 *   4. Builds start_<member> fire-and-forget tools for each online member
 *      — each tool passes isGroupChat + workspace path via A2A message metadata
 *        so the member executor switches to group-chat mode (shared cwd, reminders)
 *   5. Runs SDK query() with the orchestrator AI, which selects 1–3 members
 *      and delegates work
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { consola } from "consola";
import type { AgentExecutor, RequestContext, ExecutionEventBus } from "@a2a-js/sdk/server";
import { tool, query, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentGroup } from "@@/lib/agent-links-schemas";
import { GROUP_WORKSPACE_ROOT, agentPersistentStateDir } from "@@/lib/paths";
import { readOrCreateGroupConfig } from "@@/lib/group-config";
import { readSettings } from "@@/lib/settings";
import { effectiveDoveSettings } from "@@/lib/settings-schemas";
import { resolveSettingsEnv } from "@/lib/env-resolver";
import { cloneReposIntoWorkspace } from "./workspace";
import { withMcpQuery, consumeQueryEvents } from "@/lib/query-events";
import { A2AQueryDispatcher } from "@/lib/query-dispatcher";
import { extractInstruction } from "./message-parts";
import { ExecutorPublisher } from "./executor-publisher";
import { markProcessing, markIdle } from "./processing-registry";
import { publishSessionEvent } from "@/lib/session-events";
import { SessionManager } from "@/lib/session-manager";
import { setSessionStatus, upsertSession } from "@/lib/db";
import { upsertProgressEntry, type ProgressEntry } from "@/lib/progress";
import { resolveAgentPort } from "@/lib/a2a-client";
import { TaskPoller } from "@/lib/task-poller";
import { isAgentOnline, isHeartbeatReady } from "@/a2a/heartbeat-server";
import { publishSessionStarted } from "@/lib/group-session-events";
import type { AgentDef } from "@@/lib/agents";

const LABEL_MAX_LEN = 60;

/** Build the orchestrator system prompt appended to the claude_code preset. */
function buildGroupOrchestratorPrompt(group: AgentGroup, memberDefs: AgentDef[]): string {
  const memberLines = memberDefs
    .filter((m) => group.members.includes(m.name))
    .map((m) => `- ${m.name}: ${m.description}`)
    .join("\n");

  return [
    `You are the orchestrator for the "${group.name}" group.`,
    group.description && `Group focus: ${group.description}`,
    `\nAvailable members:\n${memberLines}`,
    `\nYour job: Read the instruction carefully, then select the 1–3 members most relevant to the task.`,
    `Use start_* to delegate work. Use await_* to wait for a member's result when you need it before proceeding.`,
    `After delegating, briefly summarise what you assigned to whom.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Create the shared group workspace with chat_histories/ and moments/ subdirs. */
function createGroupWorkspace(groupName: string, taskId: string): string {
  mkdirSync(GROUP_WORKSPACE_ROOT, { recursive: true });
  const shortId = taskId.replace(/-/g, "").slice(0, 8);
  const workspacePath = join(GROUP_WORKSPACE_ROOT, `${groupName}-${shortId}`);
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(join(workspacePath, "chat_histories"), { recursive: true });
  mkdirSync(join(workspacePath, "moments"), { recursive: true });
  return workspacePath;
}

export class GroupQueryExecutor implements AgentExecutor {
  private abortController: AbortController | null = null;
  constructor(
    private readonly group: AgentGroup,
    private readonly allAgentDefs: AgentDef[],
  ) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const { taskId, contextId } = requestContext;
    const instruction = extractInstruction(requestContext.userMessage.parts);
    this.abortController = new AbortController();
    markProcessing(`group_${this.group.name}`, this.abortController, "dove");

    consola.start(`Running group orchestrator "${this.group.name}"…`);

    const publisher = new ExecutorPublisher(eventBus, taskId, contextId);
    const label = instruction?.slice(0, LABEL_MAX_LEN) ?? `Group Session: ${this.group.name}`;

    const innerProgress: ProgressEntry[] = [];
    const publishProgress = (text: string, artifacts: Record<string, string> = {}): void => {
      publisher.publishStatusToUI(text, artifacts);
      upsertProgressEntry(innerProgress, text, artifacts);
      upsertSession({
        id: contextId,
        agentId: `group:${this.group.name}`,
        startedAt: new Date().toISOString(),
        label,
        messages: [],
        progress: innerProgress,
        status: "running",
      });
    };

    publisher.publishTask();
    publishProgress("Starting group orchestration…");

    try {
      const groupConfig = readOrCreateGroupConfig(this.group.name);
      const globalSettings = await readSettings();

      const defaultModel = effectiveDoveSettings(globalSettings).defaultModel.trim();

      const extraEnv = resolveSettingsEnv(globalSettings, groupConfig.envVars);

      // Create shared group workspace
      const groupWorkspacePath = createGroupWorkspace(this.group.name, taskId);
      publishProgress("Created group workspace", { workspace: groupWorkspacePath });

      // Clone group repos
      const repoSlugs = groupConfig.repos
        .map((id) => globalSettings.repositories.find((r) => r.id === id))
        .filter((r): r is NonNullable<typeof r> => r !== undefined)
        .map((r) => r.githubRepo);

      if (repoSlugs.length > 0) {
        publishProgress("Cloning repositories…");
        await cloneReposIntoWorkspace(groupWorkspacePath, repoSlugs, undefined, (slug) => {
          publishProgress(`Cloning ${slug}…`);
        });
      }

      // Build fire-and-forget start_<member> tools for each online member
      const userMsgId = randomUUID();
      const memberTools = this.buildMemberTools(contextId, groupWorkspacePath);

      if (memberTools.length === 0) {
        publisher.publishStatusToUI(
          "No members are currently online for this group.",
          undefined,
          "failed",
        );
        publishSessionEvent(contextId, { type: "done" });
        return;
      }

      await withMcpQuery(memberTools, async (innerMcpServer) => {
        const dispatcher = new A2AQueryDispatcher(publisher, contextId);

        const subagentSessionId = await consumeQueryEvents(
          query({
            prompt: instruction ?? `Orchestrate the "${this.group.name}" group.`,
            options: {
              cwd: groupWorkspacePath,
              env: { ...process.env, ...extraEnv },
              ...(defaultModel ? { model: defaultModel } : {}),
              agent: `${this.group.name} Orchestrator`,
              systemPrompt: {
                type: "preset",
                preset: "claude_code",
                append: buildGroupOrchestratorPrompt(this.group, this.allAgentDefs),
              },
              additionalDirectories: [agentPersistentStateDir(`group-${this.group.name}`)],
              allowedTools: memberTools.map((t) => `mcp__agents__${(t as { name: string }).name}`),
              mcpServers: { agents: innerMcpServer },
              abortController: this.abortController ?? undefined,
              permissionMode: "acceptEdits",
              includePartialMessages: true,
              settingSources: ["project", "user", "local"],
            },
          }),
          dispatcher,
          (subSessionId) => {
            SessionManager.save(
              `group:${this.group.name}`,
              contextId,
              { output: "", progress: [] },
              {
                label,
                userText: instruction ?? "",
                userMsgId,
                subagentSessionId: subSessionId,
                workspacePath: groupWorkspacePath,
              },
            );
            setSessionStatus(contextId, "running");
            // Notify frontend of the group session so it can subscribe to the group stream
            publishSessionStarted({ agentId: `group:${this.group.name}`, sessionId: contextId });

            dispatcher.enableIncrementalSave({
              sessionId: contextId,
              agentId: `group:${this.group.name}`,
              label,
              userMsgId: randomUUID(),
              userText: instruction ?? "",
            });
          },
        );

        if (subagentSessionId) {
          consola.success(`Group "${this.group.name}" orchestration completed`);
        }

        SessionManager.save(
          `group:${this.group.name}`,
          contextId,
          { output: "", progress: dispatcher.buildProgress() },
          {
            label,
            userText: instruction ?? "",
            userMsgId: randomUUID(),
            assistantMsg: dispatcher.buildAssistantMessage(),
            subagentSessionId: subagentSessionId ?? undefined,
            workspacePath: groupWorkspacePath,
          },
        );

        publishSessionEvent(contextId, { type: "done" });
        publisher.publishStatusToUI("", undefined, "completed");
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      consola.error(`Group "${this.group.name}" orchestration failed:`, err);
      publishSessionEvent(contextId, { type: "error", content: msg });
      publisher.publishStatusToUI("", { error: msg }, "failed");
    } finally {
      this.abortController?.abort();
      this.abortController = null;
      markIdle(`group_${this.group.name}`);
      eventBus.finished();
    }
  }

  async cancelTask(): Promise<void> {
    // Aborting the controller cancels the orchestrator query() AND all member tasks —
    // each startAgentStream call registers a signal listener that calls client.cancelTask().
    this.abortController?.abort();
  }

  /** Build start_<member> + await_<member> tools for every online group member. */
  private buildMemberTools(
    groupContextId: string,
    groupWorkspacePath: string,
  ): NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]> {
    type SdkTool = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>[number];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK generic variance
    const cast = (t: unknown) => t as SdkTool;
    const groupMeta = {
      isGroupChat: true,
      groupContextId,
      groupWorkspacePath,
      groupName: this.group.name,
    };

    return this.group.members.flatMap((memberName) => {
      const memberDef = this.allAgentDefs.find((a) => a.name === memberName);
      if (!memberDef) return [];
      const online = isHeartbeatReady()
        ? isAgentOnline(memberDef.manifestKey)
        : resolveAgentPort(memberDef.manifestKey) !== null;
      if (!online) return [];

      return [
        cast(
          tool(
            `start_${memberDef.manifestKey}`,
            `Delegate a task to ${memberDef.displayName} as part of the "${this.group.name}" group. Returns a taskId immediately.`,
            { instruction: z.string().describe(`Task instruction for ${memberDef.displayName}`) },
            async ({ instruction }) =>
              new TaskPoller(
                memberDef.manifestKey,
                memberDef.displayName,
                this.abortController?.signal,
              ).start(instruction, {
                senderAgentId: `group:${this.group.name}`,
                extraMetadata: groupMeta,
              }),
          ),
        ),
        cast(
          tool(
            `await_${memberDef.manifestKey}`,
            `Wait for a previously started ${memberDef.displayName} task. Returns the result or { status: "still_running", taskId } — re-call to keep polling.`,
            { taskId: z.string().describe(`taskId from start_${memberDef.manifestKey}`) },
            async ({ taskId }) =>
              new TaskPoller(
                memberDef.manifestKey,
                memberDef.displayName,
                this.abortController?.signal,
              ).poll(taskId, {}),
          ),
        ),
      ];
    });
  }
}
