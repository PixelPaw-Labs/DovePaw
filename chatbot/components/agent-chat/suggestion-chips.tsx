"use client";

import * as React from "react";
import { animate, createScope, stagger } from "animejs";
import { Brain, Zap, Radar, FlaskConical, BellRing, MessageCircle } from "lucide-react";
import { SuggestionCard } from "./suggestion-card";

const CARDS = [
  {
    icon: Brain,
    iconBg: "bg-accent group-hover:bg-primary",
    iconColor: "text-accent-foreground group-hover:text-primary-foreground",
    title: "Experience Reflector",
    description: "What does the Experience Reflector do?",
    prompt: "What does the Experience Reflector do?",
  },
  {
    icon: Zap,
    iconBg: "bg-yellow-100 group-hover:bg-primary",
    iconColor: "text-yellow-700 group-hover:text-primary-foreground",
    title: "Get Shit Done",
    description: "How does Get Shit Done work?",
    prompt: "How does Get Shit Done work?",
  },
  {
    icon: Radar,
    iconBg: "bg-blue-100 group-hover:bg-primary",
    iconColor: "text-blue-700 group-hover:text-primary-foreground",
    title: "Release Log Sentinel",
    description: "Run the Release Log Sentinel",
    prompt: "Run the Release Log Sentinel",
  },
  {
    icon: FlaskConical,
    iconBg: "bg-purple-100 group-hover:bg-primary",
    iconColor: "text-purple-700 group-hover:text-primary-foreground",
    title: "Memory Distiller",
    description: "Explain the Memory Distiller",
    prompt: "Explain the Memory Distiller",
  },
  {
    icon: BellRing,
    iconBg: "bg-red-100 group-hover:bg-primary",
    iconColor: "text-red-600 group-hover:text-primary-foreground",
    title: "Oncall Analyzer",
    description: "Run the Oncall Analyzer",
    prompt: "Run the Oncall Analyzer",
  },
  {
    icon: MessageCircle,
    iconBg: "bg-secondary group-hover:bg-primary",
    iconColor: "text-muted-foreground group-hover:text-primary-foreground",
    title: "All Agents",
    description: "What can all my agents help with?",
    prompt: "What can all my agents help with?",
  },
];

export function SuggestionChips({ onSelect }: { onSelect: (text: string) => void }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const scopeRef = React.useRef<ReturnType<typeof createScope> | null>(null);

  React.useEffect(() => {
    if (!containerRef.current) return;
    scopeRef.current = createScope({ root: containerRef.current }).add(() => {
      animate(".suggestion-card", {
        opacity: [0, 1],
        translateY: [10, 0],
        duration: 200,
        delay: stagger(60),
        ease: "outQuad",
      });
    });
    return () => scopeRef.current?.revert(); // resets inline styles; CSS opacity-0 prevents FOUC on remount
  }, []);

  return (
    <div ref={containerRef} className="grid grid-cols-2 md:grid-cols-3 gap-3 w-full">
      {CARDS.map((c) => (
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
