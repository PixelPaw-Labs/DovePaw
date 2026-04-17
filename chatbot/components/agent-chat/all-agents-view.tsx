"use client";

import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { SuggestionCard } from "./suggestion-card";
import { useSuggestionAnimation } from "./use-suggestion-animation";

export function AllAgentsView({
  agentConfigs,
  onSelect,
}: {
  agentConfigs: AgentConfigEntry[];
  onSelect: (text: string) => void;
}) {
  const containerRef = useSuggestionAnimation();
  const cards = agentConfigs.map((a) => buildAgentDef(a).doveCard);

  return (
    <div
      ref={containerRef}
      className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-3 w-full [&_button]:w-full [&_button]:block"
    >
      {cards.map((c) => (
        <div key={c.title} className="mb-3 break-inside-avoid">
          <SuggestionCard
            icon={c.icon}
            iconBg={c.iconBg}
            iconColor={c.iconColor}
            title={c.title}
            description={c.description}
            onClick={() => onSelect(c.prompt)}
          />
        </div>
      ))}
    </div>
  );
}
