"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SuggestionCardProps {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  title: string;
  description: string;
  onClick: () => void;
}

export function SuggestionCard({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  description,
  onClick,
}: SuggestionCardProps) {
  return (
    <button
      onClick={onClick}
      className="suggestion-card group flex flex-col items-start p-5 bg-card border border-border/10 rounded-xl text-left transition-all duration-300 hover:shadow-lg hover:shadow-slate-200/60 hover:-translate-y-0.5 active:scale-[0.98] opacity-0"
    >
      <div
        className={cn(
          "w-9 h-9 mb-3 rounded-lg flex items-center justify-center transition-colors duration-300",
          iconBg,
        )}
      >
        <Icon className={cn("w-4 h-4 transition-colors duration-300", iconColor)} />
      </div>
      <h3 className="text-sm font-bold text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </button>
  );
}
