"use client";

import { Paperclip, SendHorizonal, Square, Trash2 } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";
import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemContent,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";

interface ChatInputBarProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onRemoveFromQueue: (index: number) => void;
  isLoading: boolean;
  pendingQueue: string[];
}

export function ChatInputBar({
  onSubmit,
  onCancel,
  onRemoveFromQueue,
  isLoading,
  pendingQueue,
}: ChatInputBarProps) {
  const handleSubmit = ({ text }: { text: string }) => {
    onSubmit(text);
  };

  return (
    <div>
      {pendingQueue.length > 0 && (
        <Queue className="rounded-b-none border-b-0 max-h-36 overflow-y-auto">
          <QueueSection>
            <QueueSectionTrigger>
              <QueueSectionLabel count={pendingQueue.length} label="Queued" />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                {pendingQueue.map((text, index) => (
                  <QueueItem key={index}>
                    <div className="flex items-center gap-2">
                      <QueueItemIndicator />
                      <QueueItemContent>{text}</QueueItemContent>
                      <QueueItemActions>
                        <QueueItemAction
                          aria-label="Remove from queue"
                          onClick={() => onRemoveFromQueue(index)}
                        >
                          <Trash2 size={12} />
                        </QueueItemAction>
                      </QueueItemActions>
                    </div>
                  </QueueItem>
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        </Queue>
      )}

      <PromptInput
        onSubmit={handleSubmit}
        className={`**:data-[slot=input-group]:relative **:data-[slot=input-group]:flex **:data-[slot=input-group]:items-center **:data-[slot=input-group]:bg-input **:data-[slot=input-group]:shadow-2xl **:data-[slot=input-group]:shadow-foreground/5 **:data-[slot=input-group]:border **:data-[slot=input-group]:border-border/10 **:data-[slot=input-group]:h-auto ${pendingQueue.length > 0 ? "**:data-[slot=input-group]:rounded-t-none **:data-[slot=input-group]:rounded-b-2xl" : "**:data-[slot=input-group]:rounded-2xl"}`}
      >
        <PromptInputBody>
          {/* Attach — absolute left */}
          <button
            type="button"
            className="absolute left-3 bottom-3 w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-secondary transition-all z-10"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Textarea — full width, padded for buttons */}
          <PromptInputTextarea
            className="py-[22px] pl-13 pr-40 text-sm placeholder:text-muted-foreground/50 resize-none"
            placeholder="Meow… what do you need, Yang?"
          />

          {/* Stop + Send — absolute right, always both visible when loading */}
          <div className="absolute right-3 bottom-3 flex items-center gap-2 z-10">
            {isLoading && (
              <button
                type="button"
                onClick={onCancel}
                className="h-8 px-3 bg-primary/10 text-primary border border-primary/20 rounded-xl font-bold text-xs flex items-center gap-1.5 hover:bg-primary/20 transition-all active:scale-[0.98]"
              >
                STOP <Square className="w-3 h-3 fill-current" />
              </button>
            )}
            <button
              type="submit"
              className="h-8 px-3 bg-primary text-primary-foreground rounded-xl font-bold text-xs flex items-center gap-1.5 hover:shadow-lg hover:shadow-primary/30 transition-all active:scale-[0.98]"
            >
              {isLoading ? "QUEUE" : "SEND"} <SendHorizonal className="w-3.5 h-3.5" />
            </button>
          </div>
        </PromptInputBody>
      </PromptInput>
    </div>
  );
}
