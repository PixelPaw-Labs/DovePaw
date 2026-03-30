"use client";

import { MessageCircle } from "lucide-react";
import { AGENTS } from "@@/lib/agents";
import { SuggestionCard } from "./suggestion-card";
import { useSuggestionAnimation } from "./use-suggestion-animation";

const ALL_AGENTS_CARD = {
  icon: MessageCircle,
  iconBg: "bg-secondary group-hover:bg-primary",
  iconColor: "text-muted-foreground group-hover:text-primary-foreground",
  title: "All Agents",
  description: "What can all my agents help with?",
  prompt: "What can all my agents help with?",
};

export function SuggestionChips({ onSelect }: { onSelect: (text: string) => void }) {
  const containerRef = useSuggestionAnimation();
  const cards = [...AGENTS.map((a) => a.doveCard), ALL_AGENTS_CARD];

  return (
    <div ref={containerRef} className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full">
      {cards.map((c) => (
        <SuggestionCard
          key={c.title}
          icon={c.icon}
          iconBg={c.iconBg}
          iconColor={c.iconColor}
          title={c.title}
          description={c.description}
          onClick={() => onSelect(c.prompt)}
        />
      ))}
    </div>
  );
}
