"use client";

import * as React from "react";
import { Grid2x2Plus } from "lucide-react";
import { buildAgentDef } from "@@/lib/agents";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { SuggestionCard } from "./suggestion-card";
import { useSuggestionAnimation } from "./use-suggestion-animation";
import { pickRandom } from "./pick-random";

type DoveCard = ReturnType<typeof buildAgentDef>["doveCard"];

const MORE_CARD = {
  icon: Grid2x2Plus,
  iconBg: "bg-secondary group-hover:bg-primary",
  iconColor: "text-muted-foreground group-hover:text-primary-foreground",
  title: "More agents",
  description: "Browse all your agents.",
};

const RANDOM_CARD_COUNT = 8;

export function SuggestionChips({
  agentConfigs,
  onSelect,
  onShowAllAgents,
}: {
  agentConfigs: AgentConfigEntry[];
  onSelect: (text: string) => void;
  onShowAllAgents: () => void;
}) {
  const [cards, setCards] = React.useState<DoveCard[] | null>(null);
  React.useEffect(() => {
    setCards(pickRandom(agentConfigs, RANDOM_CARD_COUNT).map((a) => buildAgentDef(a).doveCard));
  }, [agentConfigs]);

  if (!cards) return null;

  return (
    <SuggestionChipsInner cards={cards} onSelect={onSelect} onShowAllAgents={onShowAllAgents} />
  );
}

function SuggestionChipsInner({
  cards,
  onSelect,
  onShowAllAgents,
}: {
  cards: DoveCard[];
  onSelect: (text: string) => void;
  onShowAllAgents: () => void;
}) {
  const containerRef = useSuggestionAnimation();

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
      <SuggestionCard
        icon={MORE_CARD.icon}
        iconBg={MORE_CARD.iconBg}
        iconColor={MORE_CARD.iconColor}
        title={MORE_CARD.title}
        description={MORE_CARD.description}
        onClick={onShowAllAgents}
      />
    </div>
  );
}
