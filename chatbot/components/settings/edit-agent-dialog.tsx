"use client";

import * as React from "react";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { AgentConfigEntry, AgentSchedule } from "@@/lib/agents-config-schemas";
import { DEFAULT_ICON_STYLE } from "@@/lib/icon-registry";
import { IconPicker } from "./icon-picker";

type ScheduleType = "none" | "interval" | "calendar";
const SCHEDULE_TYPES = ["none", "interval", "calendar"] as const;
function isScheduleType(v: string): v is ScheduleType {
  return (SCHEDULE_TYPES as readonly string[]).includes(v);
}

interface FormState {
  alias: string;
  displayName: string;
  description: string;
  iconName: string;
  iconBg: string;
  iconColor: string;
  scheduleType: ScheduleType;
  intervalSeconds: string;
  calendarHour: string;
  calendarMinute: string;
  calendarWeekday: string;
  runAtLoad: boolean;
  schedulingEnabled: boolean;
  doveCardTitle: string;
  doveCardDescription: string;
  doveCardPrompt: string;
  suggestions: Array<{ title: string; description: string; prompt: string }>;
}

function scheduleToType(schedule: AgentSchedule | undefined): ScheduleType {
  if (!schedule) return "none";
  return schedule.type === "interval" ? "interval" : "calendar";
}

function entryToForm(entry: AgentConfigEntry): FormState {
  const schedType = scheduleToType(entry.schedule);
  return {
    alias: entry.alias,
    displayName: entry.displayName,
    description: entry.description,
    iconName: entry.iconName ?? "Bot",
    iconBg: entry.iconBg ?? DEFAULT_ICON_STYLE.iconBg,
    iconColor: entry.iconColor ?? DEFAULT_ICON_STYLE.iconColor,
    scheduleType: schedType,
    intervalSeconds: entry.schedule?.type === "interval" ? String(entry.schedule.seconds) : "300",
    calendarHour: entry.schedule?.type === "calendar" ? String(entry.schedule.hour) : "0",
    calendarMinute: entry.schedule?.type === "calendar" ? String(entry.schedule.minute) : "0",
    calendarWeekday:
      entry.schedule?.type === "calendar" && entry.schedule.weekday !== undefined
        ? String(entry.schedule.weekday)
        : "",
    runAtLoad: entry.runAtLoad ?? false,
    schedulingEnabled: entry.schedulingEnabled !== false,
    doveCardTitle: entry.doveCard.title,
    doveCardDescription: entry.doveCard.description,
    doveCardPrompt: entry.doveCard.prompt,
    suggestions:
      entry.suggestions.length > 0
        ? entry.suggestions
        : [{ title: "", description: "", prompt: "" }],
  };
}

function buildPatch(name: string, f: FormState): AgentConfigEntry {
  const schedule =
    f.scheduleType === "interval"
      ? { type: "interval" as const, seconds: parseInt(f.intervalSeconds, 10) }
      : f.scheduleType === "calendar"
        ? {
            type: "calendar" as const,
            hour: parseInt(f.calendarHour, 10),
            minute: parseInt(f.calendarMinute, 10),
            ...(f.calendarWeekday !== "" ? { weekday: parseInt(f.calendarWeekday, 10) } : {}),
          }
        : undefined;

  return {
    name,
    alias: f.alias.trim(),
    displayName: f.displayName.trim(),
    description: f.description.trim(),
    iconName: f.iconName,
    iconBg: f.iconBg,
    iconColor: f.iconColor,
    ...(schedule ? { schedule } : {}),
    ...(f.runAtLoad ? { runAtLoad: true } : {}),
    schedulingEnabled: f.schedulingEnabled,
    doveCard: {
      title: f.doveCardTitle.trim(),
      description: f.doveCardDescription.trim(),
      prompt: f.doveCardPrompt.trim(),
    },
    suggestions: f.suggestions
      .filter((s) => s.title.trim() || s.prompt.trim())
      .map((s) => ({
        title: s.title.trim(),
        description: s.description.trim() || s.title.trim(),
        prompt: s.prompt.trim(),
      })),
  };
}

interface EditAgentDialogProps {
  agent: AgentConfigEntry | null;
  onSave: (entry: AgentConfigEntry) => void;
  onClose: () => void;
}

export function EditAgentDialog({ agent, onSave, onClose }: EditAgentDialogProps) {
  const [form, setForm] = React.useState<FormState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (agent) {
      setForm(entryToForm(agent));
      setError(null);
    }
  }, [agent]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form || !agent) return;
    if (!form.alias.trim()) return setError("Alias is required");
    if (!form.displayName.trim()) return setError("Display name is required");
    if (!form.description.trim()) return setError("Description is required");
    onSave(buildPatch(agent.name, form));
    onClose();
  }

  function addSuggestion() {
    if (!form) return;
    set("suggestions", [...form.suggestions, { title: "", description: "", prompt: "" }]);
  }

  function removeSuggestion(i: number) {
    if (!form) return;
    set(
      "suggestions",
      form.suggestions.filter((_, idx) => idx !== i),
    );
  }

  function setSuggestion(i: number, field: "title" | "description" | "prompt", value: string) {
    if (!form) return;
    set(
      "suggestions",
      form.suggestions.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    );
  }

  return (
    <Dialog open={agent !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Agent — {agent?.displayName}</DialogTitle>
        </DialogHeader>

        {form && agent && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            {/* Basic */}
            <Section label="Identity">
              <Row label="Name" hint="Read-only — used as identifier">
                <Input
                  value={agent.name}
                  readOnly
                  className="font-mono text-sm bg-muted cursor-default"
                />
              </Row>
              <Row label="Alias">
                <Input
                  value={form.alias}
                  onChange={(e) => set("alias", e.target.value)}
                  className="font-mono text-sm"
                />
              </Row>
              <Row label="Display Name">
                <Input
                  value={form.displayName}
                  onChange={(e) => set("displayName", e.target.value)}
                />
              </Row>
              <Row label="Description">
                <Textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  rows={3}
                />
              </Row>
              <Row label="Icon">
                <IconPicker
                  iconName={form.iconName}
                  iconBg={form.iconBg}
                  iconColor={form.iconColor}
                  onChange={(name, bg, color) => {
                    set("iconName", name);
                    set("iconBg", bg);
                    set("iconColor", color);
                  }}
                />
              </Row>
            </Section>

            {/* Schedule */}
            <Section label="Schedule">
              <label className="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.schedulingEnabled}
                  onChange={(e) => set("schedulingEnabled", e.target.checked)}
                  className="w-4 h-4 shrink-0"
                />
                <div>
                  <span className="text-sm font-medium text-on-surface">Enable scheduling</span>
                  <p className="text-[11px] text-muted-foreground">
                    Uncheck to hide from Scheduled Agents Management
                  </p>
                </div>
              </label>
              <div
                className={`flex flex-col gap-3${!form.schedulingEnabled ? " opacity-40 pointer-events-none" : ""}`}
              >
                <Row label="Schedule type">
                  <select
                    value={form.scheduleType}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (isScheduleType(v)) set("scheduleType", v);
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-40"
                  >
                    <option value="none">On demand</option>
                    <option value="interval">Interval</option>
                    <option value="calendar">Calendar (time of day)</option>
                  </select>
                </Row>
                {form.scheduleType === "interval" && (
                  <Row label="Every N seconds">
                    <Input
                      type="number"
                      value={form.intervalSeconds}
                      onChange={(e) => set("intervalSeconds", e.target.value)}
                      min={1}
                      className="font-mono text-sm"
                    />
                  </Row>
                )}
                {form.scheduleType === "calendar" && (
                  <>
                    <Row label="Hour (0–23)">
                      <Input
                        type="number"
                        value={form.calendarHour}
                        onChange={(e) => set("calendarHour", e.target.value)}
                        min={0}
                        max={23}
                        className="font-mono text-sm"
                      />
                    </Row>
                    <Row label="Minute (0–59)">
                      <Input
                        type="number"
                        value={form.calendarMinute}
                        onChange={(e) => set("calendarMinute", e.target.value)}
                        min={0}
                        max={59}
                        className="font-mono text-sm"
                      />
                    </Row>
                    <Row label="Weekday (1=Mon…7=Sun, optional)">
                      <Input
                        type="number"
                        value={form.calendarWeekday}
                        onChange={(e) => set("calendarWeekday", e.target.value)}
                        min={1}
                        max={7}
                        placeholder="Leave blank for daily"
                        className="font-mono text-sm"
                      />
                    </Row>
                  </>
                )}
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.runAtLoad}
                    onChange={(e) => set("runAtLoad", e.target.checked)}
                    className="w-4 h-4 shrink-0"
                  />
                  <span className="text-sm font-medium text-on-surface">
                    Start immediately when loaded
                  </span>
                </label>
              </div>
            </Section>

            {/* Dove card */}
            <Section label="Intro Card">
              <Row label="Title">
                <Input
                  value={form.doveCardTitle}
                  onChange={(e) => set("doveCardTitle", e.target.value)}
                />
              </Row>
              <Row label="Description">
                <Input
                  value={form.doveCardDescription}
                  onChange={(e) => set("doveCardDescription", e.target.value)}
                />
              </Row>
              <Row label="Prompt">
                <Input
                  value={form.doveCardPrompt}
                  onChange={(e) => set("doveCardPrompt", e.target.value)}
                />
              </Row>
            </Section>

            {/* Suggestions */}
            <Section label="Suggestion Chips">
              <div className="flex flex-col gap-3">
                {form.suggestions.map((s, i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-2 p-3 rounded-lg border border-border/40"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Suggestion {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSuggestion(i)}
                        className="text-muted-foreground/50 hover:text-destructive"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                        Title
                      </label>
                      <Input
                        value={s.title}
                        onChange={(e) => setSuggestion(i, "title", e.target.value)}
                        placeholder="e.g. Run now"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                        Description
                      </label>
                      <Input
                        value={s.description}
                        onChange={(e) => setSuggestion(i, "description", e.target.value)}
                        placeholder="Short label (defaults to title)"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">
                        Prompt
                      </label>
                      <Input
                        value={s.prompt}
                        onChange={(e) => setSuggestion(i, "prompt", e.target.value)}
                        placeholder="Message sent when clicked"
                      />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={addSuggestion}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add suggestion
                </Button>
              </div>
            </Section>

            {error && (
              <p className="text-sm text-destructive rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit">Save Changes</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</h3>
      {children}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-3">
      <div className="pt-2">
        <label className="text-sm font-medium text-on-surface">{label}</label>
        {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
