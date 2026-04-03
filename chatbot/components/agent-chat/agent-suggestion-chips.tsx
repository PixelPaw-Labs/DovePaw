"use client";

import type { AgentSuggestion } from "@@/lib/agents";
import { SuggestionCard } from "./suggestion-card";
import { useSuggestionAnimation } from "./use-suggestion-animation";

export function AgentSuggestionChips({
  suggestions,
  onSelect,
}: {
  suggestions: AgentSuggestion[];
  onSelect: (text: string) => void;
}) {
  const containerRef = useSuggestionAnimation();

  if (suggestions.length === 0) return null;

  return (
    <div ref={containerRef} className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full">
      {suggestions.map((s) => (
        <SuggestionCard
          key={s.title}
          icon={s.icon}
          iconBg={s.iconBg}
          iconColor={s.iconColor}
          title={s.title}
          description={s.description}
          onClick={() => onSelect(s.prompt)}
        />
      ))}
    </div>
  );
}
