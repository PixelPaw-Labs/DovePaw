/** Shared helpers for agent add/edit forms. */

import * as React from "react";

export type ScheduleType = "none" | "interval" | "calendar" | "onetime";
const SCHEDULE_TYPES = ["none", "interval", "calendar", "onetime"] as const;
export function isScheduleType(v: string): v is ScheduleType {
  return (SCHEDULE_TYPES as readonly string[]).includes(v);
}

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{label}</h3>
      {children}
    </div>
  );
}

export function Row({
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
