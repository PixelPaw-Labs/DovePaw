"use client";

import { buildAgentDef } from "@@/lib/agents";
import { type AgentConfigEntry, formatScheduleDisplay } from "@@/lib/agents-config-schemas";
import { DOVE_AVATAR } from "@/lib/avatars";
import { useDoveSettings } from "@/components/hooks/use-dove-settings";
import { SuggestionChips } from "./suggestion-chips";
import { AgentSuggestionChips } from "./agent-suggestion-chips";
import { AllAgentsView } from "./all-agents-view";

interface IntroCardProps {
  agentConfigs: AgentConfigEntry[];
  onSelect: (text: string) => void;
  agentId?: string;
  showAllAgents?: boolean;
  onShowAllAgentsChange?: (value: boolean) => void;
}

function getDoveAge() {
  const born = new Date(2021, 9); // October 2021 (month is 0-indexed)
  const now = new Date();
  const years = now.getFullYear() - born.getFullYear();
  const months = now.getMonth() - born.getMonth() + years * 12;
  const fullYears = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) return `${fullYears} years old`;
  return `${fullYears} years ${remainingMonths} month${remainingMonths > 1 ? "s" : ""} old`;
}

function DoveIntro({
  agentConfigs,
  onSelect,
  showAllAgents,
  onShowAllAgentsChange,
}: {
  agentConfigs: AgentConfigEntry[];
  onSelect: (text: string) => void;
  showAllAgents: boolean;
  onShowAllAgentsChange: (value: boolean) => void;
}) {
  const age = getDoveAge();
  const dove = useDoveSettings();
  const avatarUrl = dove.avatarUrl || DOVE_AVATAR;
  const title = dove.landingTitle.trim() || "Hello, I am Dove, your working pet!";
  const description =
    dove.landingDescription.trim() ||
    `My cat, ${age}, and your agent wrangler. I've got agents napping until you need them. Just say the word — or a treat works too. 🐾`;

  if (showAllAgents) {
    return (
      <div className="flex flex-col gap-4 w-full">
        <AllAgentsView agentConfigs={agentConfigs} onSelect={onSelect} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-3xl">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-linear-to-r from-accent to-secondary rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-1000" />
        <div className="relative bg-card rounded-2xl p-5 flex gap-4 items-start shadow-sm">
          <div className="w-12 h-12 rounded-2xl shrink-0 shadow-2xl ring-4 ring-white overflow-hidden">
            <img src={avatarUrl} alt={dove.displayName} className="w-full h-full object-cover" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground mb-1.5">{title}</h2>
            <p className="text-muted-foreground leading-relaxed max-w-2xl">{description}</p>
          </div>
        </div>
      </div>
      <SuggestionChips
        agentConfigs={agentConfigs}
        onSelect={onSelect}
        onShowAllAgents={() => onShowAllAgentsChange(true)}
      />
    </div>
  );
}

function AgentIntro({
  agentConfigs,
  agentId,
  onSelect,
}: {
  agentConfigs: AgentConfigEntry[];
  agentId: string;
  onSelect: (text: string) => void;
}) {
  const entry = agentConfigs.find((a) => a.name === agentId);
  if (!entry) return null;
  const agent = buildAgentDef(entry);
  const Icon = agent.icon;

  return (
    <div className="flex flex-col gap-4 w-full max-w-3xl">
      <div className="relative group">
        <div className="absolute -inset-0.5 bg-linear-to-r from-accent to-secondary rounded-2xl blur opacity-20 group-hover:opacity-30 transition duration-1000" />
        <div className="relative bg-card rounded-2xl p-5 flex gap-4 items-start shadow-sm">
          <div
            className={`w-12 h-12 rounded-2xl shrink-0 shadow-2xl ring-4 ring-white overflow-hidden flex items-center justify-center ${agent.iconBg} ${agent.iconColor}`}
          >
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground mb-1.5">
              {agent.displayName}
            </h2>
            <p className="text-muted-foreground leading-relaxed max-w-2xl">{agent.description}</p>
            <p className="text-xs text-muted-foreground/60 mt-2 uppercase tracking-wider">
              Schedule: {formatScheduleDisplay(agent.schedule)}
            </p>
          </div>
        </div>
      </div>
      <AgentSuggestionChips key={agentId} suggestions={agent.suggestions} onSelect={onSelect} />
    </div>
  );
}

export function IntroCard({
  agentConfigs,
  onSelect,
  agentId = "dove",
  showAllAgents = false,
  onShowAllAgentsChange,
}: IntroCardProps) {
  if (agentId === "dove") {
    return (
      <DoveIntro
        agentConfigs={agentConfigs}
        onSelect={onSelect}
        showAllAgents={showAllAgents}
        onShowAllAgentsChange={onShowAllAgentsChange ?? (() => {})}
      />
    );
  }
  return <AgentIntro agentConfigs={agentConfigs} agentId={agentId} onSelect={onSelect} />;
}
