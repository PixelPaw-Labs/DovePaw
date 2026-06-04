"use client";

import * as React from "react";
import { z } from "zod";

const statusSchema = z.object({
  sidecarRunning: z.boolean(),
  studioUrl: z.string().optional(),
});

export interface OpenVikingStatus {
  sidecarRunning: boolean;
  /** URL of the sidecar's built-in Web Studio, or `null` when not running. */
  studioUrl: string | null;
}

const POLL_MS = 5000;

export function useOpenVikingStatus(): OpenVikingStatus {
  const [state, setState] = React.useState<OpenVikingStatus>({
    sidecarRunning: false,
    studioUrl: null,
  });

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
          studioUrl: parsed.data.studioUrl ?? null,
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

  return state;
}
