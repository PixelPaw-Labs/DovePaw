"use client";

import * as React from "react";
import { Bell } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentNotificationConfig } from "@@/lib/settings-schemas";

const apiErrorSchema = z.object({ error: z.string().optional() });

interface AgentNotificationsTabProps {
  agentName: string;
  initialNotifications: AgentNotificationConfig | null;
}

export function AgentNotificationsTab({
  agentName,
  initialNotifications,
}: AgentNotificationsTabProps) {
  const [config, setConfig] = React.useState(initialNotifications);
  const [enabled, setEnabled] = React.useState(initialNotifications?.enabled ?? true);
  const [topic, setTopic] = React.useState(
    initialNotifications?.channel.type === "ntfy" ? initialNotifications.channel.topic : "",
  );
  const [server, setServer] = React.useState(
    initialNotifications?.channel.type === "ntfy"
      ? initialNotifications.channel.server
      : "https://ntfy.sh",
  );
  const [onSessionStart, setOnSessionStart] = React.useState(
    initialNotifications?.onSessionStart ?? false,
  );
  const [onSessionEnd, setOnSessionEnd] = React.useState(
    initialNotifications?.onSessionEnd ?? true,
  );
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const hasConfig = config !== null;
  const topicTrimmed = topic.trim();
  const serverTrimmed = server.trim() || "https://ntfy.sh";
  const canSave = topicTrimmed.length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const notifications: AgentNotificationConfig = {
        enabled,
        onSessionStart,
        onSessionEnd,
        channel: { type: "ntfy", topic: topicTrimmed, server: serverTrimmed },
      };
      const res = await fetch("/api/settings/agent-notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName, notifications }),
      });
      if (!res.ok) {
        const data = apiErrorSchema.safeParse(await res.json());
        setError(data.success ? (data.data.error ?? "Failed to save") : "Failed to save");
        return;
      }
      setConfig(notifications);
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    setError(null);
    try {
      await fetch(`/api/settings/agent-notifications?agentName=${encodeURIComponent(agentName)}`, {
        method: "DELETE",
      });
      setConfig(null);
      setTopic("");
      setServer("https://ntfy.sh");
      setEnabled(true);
      setOnSessionStart(false);
      setOnSessionEnd(true);
    } catch {
      setError("Failed to remove");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-on-surface-variant">
          Notifications
        </h3>
        <div className="flex-1 h-px bg-outline-variant/20" />
      </div>

      {!hasConfig && (
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container">
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-on-surface-variant">
            <Bell className="w-10 h-10 opacity-30" />
            <p className="text-sm font-medium">No notifications configured</p>
            <p className="text-xs opacity-60">
              Configure an ntfy channel to receive session alerts on your devices.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5 max-w-xl">
        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-on-surface">Enable notifications</p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Send alerts when this agent&apos;s session starts or ends.
            </p>
          </div>
          <label className="inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              aria-label="Enable notifications"
            />
            <div className="relative w-11 h-6 rounded-full transition-colors duration-200 bg-slate-300 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 after:absolute after:content-[''] after:top-[2px] after:left-[2px] after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow-sm after:transition-all after:duration-200 peer-checked:after:translate-x-5" />
          </label>
        </div>

        {/* ntfy channel */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Channel — ntfy
          </p>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-on-surface" htmlFor="ntfy-topic">
              Topic <span className="text-destructive">*</span>
            </label>
            <Input
              id="ntfy-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="my-secret-topic or $NTFY_TOPIC"
              disabled={!enabled}
              className="font-mono text-sm"
            />
            <p className="text-xs text-on-surface-variant">
              The ntfy topic to publish to. Use a private, hard-to-guess name, or reference an env
              var (e.g. <code className="font-mono">$NTFY_TOPIC</code>).
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-medium text-on-surface" htmlFor="ntfy-server">
              Server URL
            </label>
            <Input
              id="ntfy-server"
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="https://ntfy.sh"
              disabled={!enabled}
              className="font-mono text-sm"
            />
            <p className="text-xs text-on-surface-variant">
              Leave blank to use the default public server (ntfy.sh) or set your self-hosted URL.
            </p>
          </div>
        </div>

        {/* Event toggles */}
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            Events
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={onSessionStart}
              onChange={(e) => setOnSessionStart(e.target.checked)}
              disabled={!enabled}
              className="w-4 h-4 rounded border-outline-variant accent-primary"
            />
            <span className="text-sm text-on-surface">Session Start</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={onSessionEnd}
              onChange={(e) => setOnSessionEnd(e.target.checked)}
              disabled={!enabled}
              className="w-4 h-4 rounded border-outline-variant accent-primary"
            />
            <span className="text-sm text-on-surface">Session End</span>
          </label>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button onClick={() => void handleSave()} disabled={saving || !canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
          {hasConfig && (
            <Button
              variant="ghost"
              onClick={() => void handleRemove()}
              disabled={removing}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              {removing ? "Removing…" : "Remove"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
