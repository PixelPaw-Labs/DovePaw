"use client";

import { useState } from "react";
import type { ChatSseQuestion, Question, QuestionOption } from "@/lib/chat-sse";
import { cn } from "@/lib/utils";
import {
  Confirmation,
  ConfirmationBody,
  ConfirmationTitle,
  ConfirmationActions,
  ConfirmationAction,
} from "@/components/ai-elements/confirmation";
import { HelpCircle, Send } from "lucide-react";

interface QuestionBannerProps {
  request: ChatSseQuestion;
  onSubmit: (answers: Record<string, string>) => void;
}

function SingleQuestion({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: string[];
  onChange: (labels: string[]) => void;
}) {
  const toggle = (label: string) => {
    if (q.multiSelect) {
      onChange(value.includes(label) ? value.filter((l) => l !== label) : [...value, label]);
    } else {
      onChange([label]);
    }
  };

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">
        <span className="text-muted-foreground mr-1.5">{q.header}:</span>
        {q.question}
      </p>
      <div className="flex flex-col gap-1">
        {q.options.map((opt: QuestionOption) => {
          const selected = value.includes(opt.label);
          return (
            <button
              key={opt.label}
              type="button"
              onClick={() => toggle(opt.label)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md border text-xs transition-colors",
                selected
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/40 bg-background/50 text-muted-foreground hover:border-primary/30 hover:bg-primary/5",
              )}
            >
              <span className="font-medium text-foreground">{opt.label}</span>
              {opt.description && (
                <span className="ml-1.5 text-muted-foreground">— {opt.description}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function QuestionBanner({ request, onSubmit }: QuestionBannerProps) {
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(request.questions.map((q) => [q.question, []])),
  );

  const allAnswered = request.questions.every((q) => (selections[q.question] ?? []).length > 0);

  const handleSubmit = () => {
    const answers: Record<string, string> = {};
    for (const q of request.questions) {
      answers[q.question] = (selections[q.question] ?? []).join(", ");
    }
    onSubmit(answers);
  };

  return (
    <Confirmation state="pending">
      <HelpCircle className="mt-0.5 size-4 text-amber-500 shrink-0" />
      <ConfirmationBody>
        <ConfirmationTitle>Claude has a question</ConfirmationTitle>
        <div className="mt-2 space-y-4">
          {request.questions.map((q) => (
            <SingleQuestion
              key={q.question}
              q={q}
              value={selections[q.question] ?? []}
              onChange={(labels) => setSelections((prev) => ({ ...prev, [q.question]: labels }))}
            />
          ))}
        </div>
        <ConfirmationActions>
          <ConfirmationAction
            variant="default"
            size="sm"
            onClick={handleSubmit}
            disabled={!allAnswered}
          >
            <Send className="size-3 mr-1" />
            Send
          </ConfirmationAction>
        </ConfirmationActions>
      </ConfirmationBody>
    </Confirmation>
  );
}
