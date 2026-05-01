"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";

interface Slide {
  id: string;
  number: string;
  tag: string;
  title: string;
  subtitle: string;
  description: string;
  points: string[];
  gif: string;
  gifAlt: string;
}

const SLIDES: Slide[] = [
  {
    id: "overview",
    number: "01",
    tag: "Platform",
    title: "DovePaw",
    subtitle: "Plugin-based multi-agent orchestration",
    description:
      "Run autonomous AI agents from a chatbot UI, trigger them via other agents, or schedule them as persistent daemons — all without touching a single config file.",
    points: [
      "Chat with any registered agent directly in the browser UI",
      "Chain agents — orchestrators delegate tasks to specialists",
      "Schedule any agent as a persistent daemon",
      "Install agents from any git repo as a DovePaw plugin",
    ],
    gif: "/slides/slide-1-overview.gif",
    gifAlt: "DovePaw platform overview",
  },
  {
    id: "runtime",
    number: "02",
    tag: "Architecture",
    title: "Three-Layer Runtime",
    subtitle: "Browser → SDK → A2A → Agent",
    description:
      "Each request crosses three process boundaries. The browser streams SSE to the in-process SDK, which routes via A2A HTTP to an Express server, which spawns the agent script.",
    points: [
      "Browser UI on port 7473 — SSE for real-time streaming output",
      "Claude Agent SDK as in-process MCP server — zero network overhead",
      "One A2A Express server per agent — OS-assigned dynamic ports",
      "Agent scripts via tsx + scheduler — no bundling required",
    ],
    gif: "/slides/slide-2-runtime.gif",
    gifAlt: "Three-layer runtime architecture",
  },
  {
    id: "tools",
    number: "03",
    tag: "SDK Pattern",
    title: "Tool Trios",
    subtitle: "ask_* · start_* · await_*",
    description:
      "Every registered agent exposes exactly three MCP tools. The trio covers blocking, fire-and-forget, and polling — letting orchestrators mix strategies per task.",
    points: [
      "ask_* — blocking call, waits for the agent to complete",
      "start_* — fire-and-forget, returns a session ID immediately",
      "await_* — polls the result of a prior start_* call",
      "Mix strategies: start multiple, await selectively",
    ],
    gif: "/slides/slide-3-tools.gif",
    gifAlt: "ask_* / start_* / await_* tool trio patterns",
  },
  {
    id: "plugin",
    number: "04",
    tag: "Extensibility",
    title: "Plugin System",
    subtitle: "Any git repo can be an agent",
    description:
      "Package one or more agents as a plugin repo. DovePaw clones it, reads the manifest, registers the tools, and wires up the daemon — in under a second.",
    points: [
      "dovepaw-plugin.json manifest declares all agents in the repo",
      "Each agent: agent.json (metadata) + main.ts (entry point)",
      "Install via CLI or Settings UI — cloned to ~/.dovepaw/plugins/",
      "Per-agent config written to ~/.dovepaw/settings.agents/",
    ],
    gif: "/slides/slide-4-plugin.gif",
    gifAlt: "Plugin installation and registration flow",
  },
  {
    id: "teams",
    number: "05",
    tag: "Collaboration",
    title: "Agent Teams",
    subtitle: "Handoffs · Context · Coordination",
    description:
      "Agents work together like a real-world team. Dove orchestrates a group session — specialists communicate via typed handoff tools, pass full context at every boundary, and report results back to the user.",
    points: [
      "Dove uses init_group_* / start_group_* / await_group_* to spin up the team",
      "Peer messaging: start_chat_to_<agent> / await_chat_to_<agent>",
      "Work review: start_review_with_<agent> — approve / reject with justification",
      "Escalation: start_escalate_to_<agent> when confidence or authority is insufficient",
    ],
    gif: "/slides/slide-5-teams.gif",
    gifAlt: "Agent team handoff and communication",
  },
  {
    id: "parallel",
    number: "06",
    tag: "Power Feature",
    title: "Parallel Execution",
    subtitle: "Multiple agents, zero blocking",
    description:
      "Agents that support concurrent work spawn isolated git worktrees per task and run multiple Claude CLI subprocesses simultaneously, with a watchdog that reclaims orphaned worktrees.",
    points: [
      "Each task gets an isolated git worktree — no file conflicts",
      "Multiple Claude CLI subprocesses run in true parallelism",
      "Watchdog reclaims orphaned worktrees on agent exit",
      "Results committed and PRs created automatically per task",
    ],
    gif: "/slides/slide-6-parallel.gif",
    gifAlt: "Parallel agent execution in isolated worktrees",
  },
];

export function AboutSlideShow() {
  const [current, setCurrent] = React.useState(0);

  const prev = React.useCallback(() => setCurrent((i) => Math.max(0, i - 1)), []);
  const next = React.useCallback(() => setCurrent((i) => Math.min(SLIDES.length - 1, i + 1)), []);

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  const slide = SLIDES[current];

  return (
    <div className="flex h-full">
      {/* Left panel — text */}
      <div className="w-95 shrink-0 flex flex-col justify-between py-10 px-9 border-r border-border/20 overflow-hidden">
        <div className="space-y-6 min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Home
          </Link>

          {/* Slide counter + tag */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-primary tracking-[0.25em] uppercase shrink-0">
              {slide.number} / {String(SLIDES.length).padStart(2, "0")}
            </span>
            <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-primary/10 text-primary truncate">
              {slide.tag}
            </span>
          </div>

          {/* Title + subtitle */}
          <div>
            <h2
              key={slide.id}
              className="text-[2rem] font-bold tracking-tight text-foreground leading-tight"
            >
              {slide.title}
            </h2>
            <p className="text-sm font-mono text-primary/70 mt-2 tracking-wide leading-relaxed">
              {slide.subtitle}
            </p>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">{slide.description}</p>

          {/* Key points */}
          <ul className="space-y-3">
            {slide.points.map((point, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <span className="shrink-0 mt-1 w-1 h-1 rounded-full bg-primary/60" />
                {point}
              </li>
            ))}
          </ul>
        </div>

        {/* Navigation */}
        <div className="space-y-5 shrink-0">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5">
            {SLIDES.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrent(i)}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === current ? "w-6 bg-primary" : "w-1.5 bg-border hover:bg-primary/40"
                }`}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>

          {/* Prev / Next buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={prev}
              disabled={current === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border/60 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              onClick={next}
              disabled={current === SLIDES.length - 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Keyboard hint */}
          <p className="text-[10px] text-muted-foreground/40 font-mono tracking-wider">
            ← → arrow keys to navigate
          </p>
        </div>
      </div>

      {/* Right panel — animation */}
      <div className="flex-1 bg-background flex items-center justify-center min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={slide.gif}
          src={slide.gif}
          alt={slide.gifAlt}
          className="w-full h-full object-contain"
        />
      </div>
    </div>
  );
}
