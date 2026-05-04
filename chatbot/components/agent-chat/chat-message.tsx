"use client";

import { Ban } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DOVE_AVATAR, USER_AVATAR } from "@/lib/avatars";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { MessageContent, MessageResponse } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import type { ChatMessage } from "@/components/hooks/use-messages";
import { messageText } from "@/components/hooks/use-messages";
import { AnimatedMessage } from "./animated-message";
import { CopyAction } from "./copy-action";
import { EditDiffList, ToolCallItem } from "./tool-call-badge";

// Width of avatar (w-8 = 2rem) + gap (gap-2 = 0.5rem) → pl-10 (2.5rem)
const AVATAR_OFFSET = "pl-10";

const MESSAGE_RESPONSE_SPACING =
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h3]:mt-3 [&_h3]:mb-1 [&_h4]:mt-2.5 [&_h4]:mb-1 [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:my-0.5 [&_pre]:my-2";

type AvatarInfo =
  | { type: "dove" }
  | { type: "agent"; icon: LucideIcon; iconBg: string; iconColor: string };

export function resolveAvatar(
  agentId: string | undefined,
  agentConfigs: AgentConfigEntry[] | undefined,
): AvatarInfo {
  if (!agentId || agentId === "dove") return { type: "dove" };
  const entry = agentConfigs?.find((a) => a.name === agentId);
  if (!entry) return { type: "dove" };
  const { icon, iconBg, iconColor } = buildAgentDef(entry);
  return { type: "agent", icon, iconBg, iconColor };
}

function AssistantAvatar({
  avatar,
  doveDisplayName,
}: {
  avatar: AvatarInfo;
  doveDisplayName: string;
}) {
  if (avatar.type === "dove") {
    return (
      <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border-2 border-secondary shadow-sm mb-0.5">
        <img src={DOVE_AVATAR} alt={doveDisplayName} className="w-full h-full object-cover" />
      </div>
    );
  }
  const Icon = avatar.icon;
  return (
    <div
      className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center shadow-sm mb-0.5 ${avatar.iconBg}`}
    >
      <Icon className={`w-4 h-4 ${avatar.iconColor}`} />
    </div>
  );
}

function SenderAvatar({
  agentId,
  agentConfigs,
  doveDisplayName,
}: {
  agentId: string | undefined;
  agentConfigs: AgentConfigEntry[] | undefined;
  doveDisplayName: string;
}) {
  if (agentId) {
    const avatar = resolveAvatar(agentId, agentConfigs);
    return <AssistantAvatar avatar={avatar} doveDisplayName={doveDisplayName} />;
  }
  return (
    <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border-2 border-secondary shadow-sm mb-0.5">
      <img src={USER_AVATAR} alt="You" className="w-full h-full object-cover" />
    </div>
  );
}

export function ChatMessageItem({
  msg,
  agentConfigs,
  doveDisplayName = "Dove",
  hideReasoning = false,
  hideAvatars = false,
}: {
  msg: ChatMessage;
  agentConfigs?: AgentConfigEntry[];
  doveDisplayName?: string;
  hideReasoning?: boolean;
  hideAvatars?: boolean;
}) {
  const hasSegmentContent = msg.segments.some(
    (s) => (s.type === "text" && s.content) || s.type === "tool_call",
  );
  const fullText = messageText(msg);

  const messageContent = (
    <AnimatedMessage from={msg.role}>
      {/* Process block — collapsed by default, live preview in trigger while streaming */}
      {!hideReasoning && msg.processContent ? (
        <Reasoning isStreaming={!!msg.isProcessStreaming} defaultOpen={false}>
          <ReasoningTrigger
            getThinkingMessage={(isStreaming, duration) => {
              if (isStreaming) {
                const raw = (msg.processContent ?? "")
                  .split("\n")
                  .map((l) => l.trim())
                  .findLast(Boolean)
                  ?.trim();
                const preview = raw && raw.length > 60 ? `${raw.slice(0, 60)}…` : raw;
                return <Shimmer duration={1.5}>{preview || "Thinking..."}</Shimmer>;
              }
              if (duration === undefined) return <p>Thought for a few seconds</p>;
              return <p>Thought for {duration} seconds</p>;
            }}
          />
          <ReasoningContent>{msg.processContent}</ReasoningContent>
        </Reasoning>
      ) : null}

      {(hasSegmentContent || (!msg.isLoading && !msg.isCancelled && msg.role === "assistant")) && (
        <MessageContent>
          {msg.segments.map((seg, i) =>
            seg.type === "text" ? (
              seg.content ? (
                <MessageResponse key={i} className={MESSAGE_RESPONSE_SPACING}>
                  {seg.content}
                </MessageResponse>
              ) : null
            ) : msg.isLoading ? (
              (() => {
                const rest = msg.segments.slice(i + 1);
                // A later tool_call means this one is already done.
                const isCompleted = rest.some((s) => s.type === "tool_call");
                // If final text has started streaming after all tool_calls, hide entirely.
                const hasTextAfter = rest.some(
                  (s) =>
                    s.type === "text" &&
                    (s as { type: "text"; content: string }).content.trim().length > 0,
                );
                return hasTextAfter ? null : (
                  <ToolCallItem key={i} tool={seg.tool} isActive={!isCompleted} />
                );
              })()
            ) : null,
          )}
        </MessageContent>
      )}

      <EditDiffList
        toolCalls={msg.segments.filter((s) => s.type === "tool_call").map((s) => s.tool)}
      />
      {msg.isCancelled && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-bl-none bg-amber-50 border border-amber-200 text-amber-600 text-sm font-medium">
          <Ban className="w-3.5 h-3.5 shrink-0" />
          Stopped
        </div>
      )}
    </AnimatedMessage>
  );

  if (msg.role === "assistant") {
    const hasContent = hasSegmentContent || (!msg.isLoading && msg.role === "assistant");

    return (
      <div className="group/msg flex flex-col items-start gap-0.5 w-full">
        <div className="flex items-end gap-2 w-full">
          {!hideAvatars && hasContent && (
            <AssistantAvatar
              avatar={resolveAvatar(msg.agentId, agentConfigs)}
              doveDisplayName={doveDisplayName}
            />
          )}
          {messageContent}
        </div>
        {hasContent && (
          <div
            className={`${hideAvatars ? "" : AVATAR_OFFSET} opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100`}
          >
            <CopyAction text={fullText} />
          </div>
        )}
      </div>
    );
  }

  if (hideAvatars) {
    return messageContent;
  }

  return (
    <div className="group/msg flex flex-col items-end gap-0.5 w-full">
      <div className="flex items-end gap-2 w-full">
        <div className="flex-1 min-w-0">{messageContent}</div>
        <SenderAvatar
          agentId={msg.agentId}
          agentConfigs={agentConfigs}
          doveDisplayName={doveDisplayName}
        />
      </div>
    </div>
  );
}
