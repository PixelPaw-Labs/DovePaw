"use client";

import * as React from "react";
import { type DoveSettings, doveSettingsSchema } from "@@/lib/settings-schemas";

export function useDoveSettings(initial?: DoveSettings): DoveSettings {
  const [settings, setSettings] = React.useState<DoveSettings>(
    () => initial ?? doveSettingsSchema.parse({}),
  );
  React.useEffect(() => {
    fetch("/api/settings/dove")
      .then((r) => r.json())
      .then((data: unknown) => {
        const parsed = doveSettingsSchema.safeParse(data);
        if (parsed.success) setSettings(parsed.data);
      })
      .catch(() => {
        // keep defaults on error
      });
  }, []);
  return settings;
}
