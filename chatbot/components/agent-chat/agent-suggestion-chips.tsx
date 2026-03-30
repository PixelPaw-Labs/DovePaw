"use client";

import * as React from "react";
import { AGENTS } from "@@/lib/agents";
import { SuggestionCard } from "./suggestion-card";
import { useSuggestionAnimation } from "./use-suggestion-animation";

export function AgentSuggestionChips({
  agentName,
  onSelect,
}: {
  agentName: string;
  onSelect: (text: string) => void;
}) {
  const containerRef = useSuggestionAnimation();

  const agent = AGENTS.find((a) => a.name === agentName);
  const suggestions = agent?.suggestions ?? [];

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
