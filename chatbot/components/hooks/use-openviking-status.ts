"use client";

import * as React from "react";
import { z } from "zod";

const statusSchema = z.object({
  sidecarRunning: z.boolean(),
  consoleUrl: z.string().optional(),
});

export interface OpenVikingStatus {
  sidecarRunning: boolean;
  consoleUrl: string | null;
  launching: boolean;
  /** Spawn the console (if needed) and return the URL. */
  launchConsole: () => Promise<string | null>;
}

const POLL_MS = 5000;

export function useOpenVikingStatus(): OpenVikingStatus {
  const [state, setState] = React.useState<{ sidecarRunning: boolean; consoleUrl: string | null }>({
    sidecarRunning: false,
    consoleUrl: null,
  });
  const [launching, setLaunching] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const fetchStatus = async (): Promise<void> => {
      try {
        const res = await fetch("/api/openviking/status");
        if (!res.ok) return;
        const parsed = statusSchema.safeParse(await res.json());
        if (cancelled || !parsed.success) return;
        setState({
          sidecarRunning: parsed.data.sidecarRunning,
          consoleUrl: parsed.data.consoleUrl ?? null,
        });
      } catch {
        // network hiccup — keep last known state
      }
    };
    void fetchStatus();
    const id = setInterval(() => void fetchStatus(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const launchConsole = React.useCallback(async (): Promise<string | null> => {
    setLaunching(true);
    try {
      const res = await fetch("/api/openviking/console", { method: "POST" });
      if (!res.ok) return null;
      const body = z.object({ url: z.string() }).safeParse(await res.json());
      if (!body.success) return null;
      setState((prev) => ({ ...prev, consoleUrl: body.data.url }));
      return body.data.url;
    } catch {
      return null;
    } finally {
      setLaunching(false);
    }
  }, []);

  return { ...state, launching, launchConsole };
}
