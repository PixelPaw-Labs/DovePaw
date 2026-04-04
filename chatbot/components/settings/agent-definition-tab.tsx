"use client";

import * as React from "react";
import { X, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconPicker } from "./icon-picker";
import { DEFAULT_ICON_STYLE } from "@@/lib/icon-registry";
import type { AgentConfigEntry, AgentSchedule } from "@@/lib/agents-config-schemas";
import { z } from "zod";
import { agentConfigEntrySchema } from "@@/lib/agents-config-schemas";
import { type ScheduleType, isScheduleType, Section, Row } from "./agent-form-helpers";

const apiErrorSchema = z.object({ error: z.string().optional() });
const agentsResponseSchema = z.object({ agents: z.array(agentConfigEntrySchema) });

interface FormState {
  alias: string;
  displayName: string;
  description: string;
  iconName: string;
  iconBg: string;
  iconColor: string;
  scheduleDisplay: string;
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
    scheduleDisplay: entry.scheduleDisplay,
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
    scheduleDisplay: f.scheduleDisplay.trim(),
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

interface AgentDefinitionTabProps {
  agentEntry: AgentConfigEntry;
  onSaved: (updated: AgentConfigEntry) => void;
}

export function AgentDefinitionTab({ agentEntry, onSaved }: AgentDefinitionTabProps) {
  const [form, setForm] = React.useState<FormState>(() => entryToForm(agentEntry));
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [restarting, setRestarting] = React.useState(false);
  const [restartError, setRestartError] = React.useState<string | null>(null);

  // Reset form if agentEntry identity changes (navigating between agents)
  React.useEffect(() => {
    setForm(entryToForm(agentEntry));
    setError(null);
    setSaved(false);
  }, [agentEntry.name]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSaved(false);
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

  async function handleRestart() {
    setRestarting(true);
    setRestartError(null);
    try {
      const res = await fetch("/api/servers/restart", { method: "POST" });
      if (!res.ok) {
        const data = apiErrorSchema.parse(await res.json());
        setRestartError(data.error ?? "Restart failed");
        return;
      }
      setSaved(false);
    } catch {
      setRestartError("Restart failed");
    } finally {
      setRestarting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.alias.trim()) return setError("Alias is required");
    if (!form.displayName.trim()) return setError("Display name is required");
    if (!form.description.trim()) return setError("Description is required");

    setSaving(true);
    setError(null);
    try {
      const patch = buildPatch(agentEntry.name, form);
      const res = await fetch("/api/settings/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: agentEntry.name, patch }),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(apiErrorSchema.parse(json).error ?? "Failed to save");
        return;
      }
      const { agents } = agentsResponseSchema.parse(json);
      const updated = agents.find((a) => a.name === agentEntry.name);
      if (updated) onSaved(updated);
      setSaved(true);
    } catch {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-6">
      {/* Identity */}
      <Section label="Identity">
        <Row label="Name" hint="Read-only — used as identifier">
          <Input
            value={agentEntry.name}
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
          <Input value={form.displayName} onChange={(e) => set("displayName", e.target.value)} />
        </Row>
        <Row label="Description">
          <Textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            rows={4}
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
              setSaved(false);
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
              <Row label="Weekday (0–6, optional)">
                <Input
                  type="number"
                  value={form.calendarWeekday}
                  onChange={(e) => set("calendarWeekday", e.target.value)}
                  min={0}
                  max={6}
                  placeholder="Leave blank for daily"
                  className="font-mono text-sm"
                />
              </Row>
            </>
          )}
          <Row label="Schedule display">
            <Input
              value={form.scheduleDisplay}
              onChange={(e) => set("scheduleDisplay", e.target.value)}
              placeholder="e.g. daily 09:00"
            />
          </Row>
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

      {/* Suggestion chips */}
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

      <div className="flex items-center gap-3 flex-wrap">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </Button>
        {saved && (
          <button
            type="button"
            disabled={restarting}
            onClick={() => void handleRestart()}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold bg-yellow-600 text-white hover:brightness-110 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${restarting ? "animate-spin" : ""}`} />
            {restarting ? "Restarting…" : "Restart A2A"}
          </button>
        )}
        {restartError && <span className="text-sm text-destructive">{restartError}</span>}
      </div>
    </form>
  );
}
