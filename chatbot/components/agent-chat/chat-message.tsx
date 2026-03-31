"use client";

import * as React from "react";
import { Ban } from "lucide-react";
import { DOVE_AVATAR } from "@/lib/avatars";
import { MessageContent, MessageResponse, MessageToolbar } from "@/components/ai-elements/message";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import type { ChatMessage } from "@/components/hooks/use-messages";
import { messageText } from "@/components/hooks/use-messages";
import { AnimatedMessage } from "./animated-message";
import { CopyAction } from "./copy-action";
import { ThinkingDots } from "./thinking-dots";
import { EditDiffList, ToolCallItem } from "./tool-call-badge";

const MESSAGE_RESPONSE_SPACING =
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_h1]:mt-4 [&_h1]:mb-2 [&_h2]:mt-4 [&_h2]:mb-1.5 [&_h3]:mt-3 [&_h3]:mb-1 [&_h4]:mt-2.5 [&_h4]:mb-1 [&_ul]:my-2 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:pl-5 [&_li]:my-0.5 [&_pre]:my-2";

function AssistantAvatar() {
  return (
    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 border-2 border-secondary shadow-sm mb-0.5">
      <img src={DOVE_AVATAR} alt="Dove" className="w-full h-full object-cover" />
    </div>
  );
}

export function ChatMessageItem({ msg }: { msg: ChatMessage }) {
  const hasSegmentContent = msg.segments.some(
    (s) => (s.type === "text" && s.content) || s.type === "tool_call",
  );
  const fullText = messageText(msg);

  const messageContent = (
    <AnimatedMessage from={msg.role}>
      {/* Process block — collapsed by default, live preview in trigger while streaming */}
      {msg.processContent ? (
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

      {(hasSegmentContent || (!msg.isLoading && msg.role === "assistant")) && (
        <MessageContent>
          {msg.segments.map((seg, i) =>
            seg.type === "text" ? (
              seg.content ? (
                <MessageResponse key={i} className={MESSAGE_RESPONSE_SPACING}>
                  {seg.content}
                </MessageResponse>
              ) : null
            ) : msg.isLoading ? (
              <ToolCallItem key={i} tool={seg.tool} isActive={i === msg.segments.length - 1} />
            ) : null,
          )}
          {!msg.isLoading && msg.role === "assistant" && (
            <MessageToolbar className="justify-start mt-1">
              <CopyAction text={fullText} />
            </MessageToolbar>
          )}
        </MessageContent>
      )}

      <EditDiffList
        toolCalls={msg.segments.filter((s) => s.type === "tool_call").map((s) => s.tool)}
      />
    </AnimatedMessage>
  );

  if (msg.role === "assistant") {
    // Cancelled state — amber indicator
    if (msg.isCancelled && !fullText) {
      return (
        <div className="flex items-end gap-2.5 w-full">
          <AssistantAvatar />
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl rounded-bl-none bg-amber-50 border border-amber-200 text-amber-600 text-sm font-medium">
            <Ban className="w-3.5 h-3.5 shrink-0" />
            Cancelled
          </div>
        </div>
      );
    }

    // Pure loading state — no avatar, just dots
    if (msg.isLoading && !hasSegmentContent && !msg.processContent) {
      return <ThinkingDots />;
    }

    const hasContent = hasSegmentContent || (!msg.isLoading && msg.role === "assistant");

    return (
      <div className="flex items-end gap-2.5 w-full">
        {hasContent && <AssistantAvatar />}
        {messageContent}
      </div>
    );
  }

  return messageContent;
}
