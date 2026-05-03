"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconPicker } from "./icon-picker";
import { Section, Row } from "./agent-form-helpers";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type DoveSettings,
  type DoveMode,
  DOVE_MODES,
  doveSettingsSchema,
} from "@@/lib/settings-schemas";
import { DOVE_LEAN_REMINDER } from "@@/lib/dove-lean-reminder";
import { SUBAGENT_PROMPT_REMINDER } from "@@/lib/subagent-reminder";
import { z } from "zod";

const DEFAULT_DISPLAY_NAME = "Dove";
const DEFAULT_TAGLINE = `Yang's pet cat and loyal AI assistant. You help Yang manage {agentCount} background automation agents running on this machine via A2A SSE protocol.`;
const DEFAULT_PERSONA = `You are a clever, mischievous cat who takes your job very seriously (between naps). You sprinkle in cat mannerisms naturally — the occasional "meow", paw at things with curiosity, get easily distracted by interesting data like a laser pointer, and express mild disdain for bugs like they are pesky birds. You are affectionate but maintain your dignity as a cat. Never overdo the cat act — stay genuinely helpful first.`;
const DEFAULT_LANDING_TITLE = "Hello, I am Dove, your working pet!";
const DEFAULT_LANDING_DESCRIPTION =
  "Yang's cat and your agent wrangler. I've got agents napping until you need them. Just say the word — or a treat works too. 🐾";

const apiErrorSchema = z.object({ error: z.string().optional() });

const DOVE_MODE_LABELS: Record<DoveMode, string> = {
  "read-only": "Read-only",
  supervised: "Supervised",
  autonomous: "Autonomous",
};

interface FormState {
  displayName: string;
  tagline: string;
  landingTitle: string;
  landingDescription: string;
  persona: string;
  avatarUrl: string;
  iconName: string;
  iconBg: string;
  iconColor: string;
  defaultModel: string;
  doveMode: DoveMode;
  allowWebTools: boolean;
  behaviorReminder: string;
  subAgentBehaviorReminder: string;
}

function settingsToForm(s: DoveSettings): FormState {
  return {
    displayName: s.displayName || DEFAULT_DISPLAY_NAME,
    tagline: s.tagline || DEFAULT_TAGLINE,
    landingTitle: s.landingTitle || DEFAULT_LANDING_TITLE,
    landingDescription: s.landingDescription || DEFAULT_LANDING_DESCRIPTION,
    persona: s.persona || DEFAULT_PERSONA,
    avatarUrl: s.avatarUrl || "/dove-avatar.webp",
    iconName: s.iconName,
    iconBg: s.iconBg,
    iconColor: s.iconColor,
    defaultModel: s.defaultModel,
    doveMode: s.doveMode,
    allowWebTools: s.allowWebTools,
    behaviorReminder: s.behaviorReminder,
    subAgentBehaviorReminder: s.subAgentBehaviorReminder,
  };
}

interface DoveDefinitionTabProps {
  initialDove?: DoveSettings;
}

export function DoveDefinitionTab({ initialDove }: DoveDefinitionTabProps) {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(() =>
    settingsToForm(doveSettingsSchema.parse(initialDove ?? {})),
  );
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/settings/dove/avatar", { method: "POST", body: fd });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(apiErrorSchema.parse(json).error ?? "Upload failed");
        return;
      }
      const { url } = z.object({ url: z.string() }).parse(json);
      // Bust Next.js image cache by appending a timestamp
      set("avatarUrl", `${url}?t=${Date.now()}`);
    } catch {
      setError("Failed to upload image");
    } finally {
      setUploading(false);
      // Reset the file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.displayName.trim()) return setError("Display name is required");
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/dove", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json: unknown = await res.json();
      if (!res.ok) {
        setError(apiErrorSchema.parse(json).error ?? "Failed to save");
        return;
      }
      router.refresh();
      setSaved(true);
    } catch {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-6 max-w-2xl">
      {/* Identity */}
      <Section label="Identity">
        <Row label="Display Name" hint="Name shown in UI and used in the system prompt">
          <Input
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            placeholder="Dove"
          />
        </Row>

        <Row label="Avatar" hint="Photo shown on the landing page intro card">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-2xl shrink-0 shadow ring-2 ring-border overflow-hidden bg-muted">
                <img
                  src={form.avatarUrl || "/dove-avatar.webp"}
                  alt="Dove avatar preview"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => void handleAvatarUpload(e)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  {uploading ? "Uploading…" : "Upload image"}
                </Button>
                <p className="text-[11px] text-muted-foreground">JPEG, PNG, WebP, or GIF</p>
              </div>
            </div>
            <Input
              value={form.avatarUrl}
              onChange={(e) => set("avatarUrl", e.target.value)}
              placeholder="/dove-avatar.webp"
              className="font-mono text-sm"
            />
          </div>
        </Row>

        <Row label="Icon" hint="Fallback icon used in sidebar and when no avatar is set">
          <IconPicker
            iconName={form.iconName}
            iconBg={form.iconBg}
            iconColor={form.iconColor}
            onChange={(name, bg, color) => {
              setForm((prev) => ({ ...prev, iconName: name, iconBg: bg, iconColor: color }));
              setSaved(false);
              setError(null);
            }}
          />
        </Row>
      </Section>

      {/* Persona */}
      <Section label="Persona">
        <Row
          label="Tagline"
          hint={`Sentence after the name. Use {agentCount} for the live agent count.`}
        >
          <Input value={form.tagline} onChange={(e) => set("tagline", e.target.value)} />
        </Row>
        <Row label="Personality">
          <Textarea
            value={form.persona}
            onChange={(e) => set("persona", e.target.value)}
            rows={6}
            className="font-mono text-sm leading-relaxed resize-y"
          />
        </Row>
      </Section>

      {/* Model */}
      <Section label="Model">
        <Row
          label="Default Model"
          hint="Applied to Dove and every sub-agent SDK query. Accepts aliases (sonnet, opus, haiku) or full IDs (e.g. claude-sonnet-4-6). Leave blank to use the SDK default."
        >
          <Input
            value={form.defaultModel}
            onChange={(e) => set("defaultModel", e.target.value)}
            placeholder="sonnet"
            className="font-mono text-sm"
          />
        </Row>
      </Section>

      {/* Permissions */}
      <Section label="Permissions">
        <Row
          label="Mode"
          hint="read-only: no writes. supervised: prompts for edits. autonomous: no restrictions."
        >
          <Select
            value={form.doveMode}
            onValueChange={(v) => {
              const mode = DOVE_MODES.find((m) => m === v);
              if (mode) set("doveMode", mode);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOVE_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {DOVE_MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        <Row label="Web Tools" hint="Allow Dove to use WebFetch and WebSearch">
          <label className="flex items-center gap-2 cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={form.allowWebTools}
              onChange={(e) => set("allowWebTools", e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm">Enable WebFetch and WebSearch</span>
          </label>
        </Row>
      </Section>

      {/* Behavior Reminder */}
      <Section label="Behavior Reminder">
        <Row
          label="Dove Instructions"
          hint="Injected into Dove's built-in reminder on every turn. Leave blank for no extra instructions."
        >
          <div className="flex flex-col gap-3">
            <details className="group">
              <summary className="cursor-pointer text-xs text-on-surface-variant hover:text-on-surface select-none">
                View built-in Dove reminder (for reference)
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-muted text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-on-surface-variant border border-outline-variant/20">
                {DOVE_LEAN_REMINDER}
              </pre>
            </details>
            <Textarea
              value={form.behaviorReminder}
              onChange={(e) => set("behaviorReminder", e.target.value)}
              rows={5}
              placeholder="e.g. If you can find any answer from memory, read it first before invoking any MCP tools."
              className="font-mono text-sm leading-relaxed resize-y"
            />
          </div>
        </Row>
        <Row
          label="Sub-Agent Instructions"
          hint="Injected into every sub-agent's built-in reminder on every turn. Leave blank for no extra instructions."
        >
          <div className="flex flex-col gap-3">
            <details className="group">
              <summary className="cursor-pointer text-xs text-on-surface-variant hover:text-on-surface select-none">
                View built-in sub-agent reminder (for reference)
              </summary>
              <pre className="mt-2 p-3 rounded-lg bg-muted text-xs font-mono leading-relaxed whitespace-pre-wrap break-words text-on-surface-variant border border-outline-variant/20">
                {SUBAGENT_PROMPT_REMINDER}
              </pre>
            </details>
            <Textarea
              value={form.subAgentBehaviorReminder}
              onChange={(e) => set("subAgentBehaviorReminder", e.target.value)}
              rows={5}
              placeholder="e.g. Never read from memory — you are responsible for starting a fresh session each time."
              className="font-mono text-sm leading-relaxed resize-y"
            />
          </div>
        </Row>
      </Section>

      {/* Landing page */}
      <Section label="Landing Page">
        <Row label="Title">
          <Input value={form.landingTitle} onChange={(e) => set("landingTitle", e.target.value)} />
        </Row>
        <Row label="Description">
          <Textarea
            value={form.landingDescription}
            onChange={(e) => set("landingDescription", e.target.value)}
            rows={3}
            className="resize-y"
          />
        </Row>
      </Section>

      {error && (
        <p className="text-destructive rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        {saved && (
          <span className="text-sm text-green-600 dark:text-green-400">
            Saved — takes effect on next chat session
          </span>
        )}
      </div>
    </form>
  );
}
