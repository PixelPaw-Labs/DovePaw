"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { AgentConfigEntry } from "@@/lib/agents-config-schemas";
import { DEFAULT_ICON_STYLE } from "@@/lib/icon-registry";
import { IconPicker } from "./icon-picker";
import { type ScheduleType, isScheduleType, Section, Row } from "./agent-form-helpers";

interface FormState {
  name: string;
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

function emptyForm(): FormState {
  return {
    name: "",
    alias: "",
    displayName: "",
    description: "",
    iconName: "Bot",
    iconBg: DEFAULT_ICON_STYLE.iconBg,
    iconColor: DEFAULT_ICON_STYLE.iconColor,
    scheduleType: "none",
    intervalSeconds: "300",
    calendarHour: "0",
    calendarMinute: "0",
    calendarWeekday: "",
    runAtLoad: false,
    schedulingEnabled: true,
    doveCardTitle: "",
    doveCardDescription: "",
    doveCardPrompt: "",
    suggestions: [{ title: "", description: "", prompt: "" }],
  };
}

function buildEntry(f: FormState): AgentConfigEntry {
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
    name: f.name.trim(),
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
      title: f.doveCardTitle.trim() || f.displayName.trim(),
      description: f.doveCardDescription.trim() || f.displayName.trim(),
      prompt: f.doveCardPrompt.trim() || f.displayName.trim(),
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

interface AddAgentDialogProps {
  existingNames: string[];
  onAdd: (entry: AgentConfigEntry) => void;
}

export function AddAgentDialog({ existingNames, onAdd }: AddAgentDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(emptyForm);
  const [error, setError] = React.useState<string | null>(null);
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Name is required");
    if (!/^[a-z][a-z0-9-]*$/.test(form.name.trim()))
      return setError("Name must be kebab-case (e.g. my-agent)");
    if (existingNames.includes(form.name.trim()))
      return setError(`Agent "${form.name.trim()}" already exists`);
    if (!form.alias.trim()) return setError("Alias is required");
    if (!form.displayName.trim()) return setError("Display name is required");
    if (!form.description.trim()) return setError("Description is required");

    onAdd(buildEntry(form));
    setOpen(false);
    setForm(emptyForm);
    setError(null);
  }

  function addSuggestion() {
    set("suggestions", [...form.suggestions, { title: "", description: "", prompt: "" }]);
  }

  function removeSuggestion(i: number) {
    set(
      "suggestions",
      form.suggestions.filter((_, idx) => idx !== i),
    );
  }

  function setSuggestion(i: number, field: "title" | "description" | "prompt", value: string) {
    set(
      "suggestions",
      form.suggestions.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setForm(emptyForm);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="w-4 h-4" />
          Add Agent
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Agent</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Basic */}
          <Section label="Identity">
            <Row label="Name" hint="kebab-case, e.g. my-agent">
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="my-agent"
                className="font-mono text-sm"
              />
            </Row>
            <Row label="Alias" hint="Short prefix for workspace dirs (e.g. ma)">
              <Input
                value={form.alias}
                onChange={(e) => set("alias", e.target.value)}
                placeholder="ma"
                className="font-mono text-sm"
              />
            </Row>
            <Row label="Display Name">
              <Input
                value={form.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                placeholder="My Agent"
              />
            </Row>
            <Row label="Description">
              <Textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="What this agent does and when to use it…"
                rows={3}
              />
            </Row>
            <Row label="Icon">
              <IconPicker
                iconName={form.iconName}
                iconBg={form.iconBg}
                iconColor={form.iconColor}
                onChange={(name, bg, color) => {
                  setForm((prev) => ({ ...prev, iconName: name, iconBg: bg, iconColor: color }));
                  setError(null);
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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                placeholder={form.displayName || "Agent name"}
              />
            </Row>
            <Row label="Description">
              <Input
                value={form.doveCardDescription}
                onChange={(e) => set("doveCardDescription", e.target.value)}
                placeholder="Short tagline"
              />
            </Row>
            <Row label="Prompt">
              <Input
                value={form.doveCardPrompt}
                onChange={(e) => set("doveCardPrompt", e.target.value)}
                placeholder="What does it do?"
              />
            </Row>
          </Section>

          {/* Suggestions */}
          <Section label="Suggestion Chips">
            <div className="flex flex-col gap-3">
              {form.suggestions.map((s, i) => (
                <div key={i} className="flex flex-col gap-2 p-3 rounded-lg border border-border/40">
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Agent</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
