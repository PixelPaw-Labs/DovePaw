"use client";

import * as React from "react";
import { statusMessageSchema } from "@/a2a/heartbeat-types";
import type { AgentStatus } from "@/a2a/heartbeat-types";

const RECONNECT_DELAY_MS = 3_000;

export function useAgentHeartbeat(): Record<string, AgentStatus> {
  const [statuses, setStatuses] = React.useState<Record<string, AgentStatus>>({});

  React.useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      // Close any existing connection first — prevents orphaned EventSource objects when
      // called on reconnect. Without this, the old EventSource's built-in auto-reconnect
      // and our own reconnect timer both race to open new connections, leaking one slot
      // from Chromium's 6-connection-per-origin limit on each server restart / HMR event.
      es?.close();
      es = new EventSource("/api/heartbeat");

      es.addEventListener("message", (event) => {
        try {
          if (typeof event.data !== "string") return;
          const result = statusMessageSchema.safeParse(JSON.parse(event.data));
          if (result.success) setStatuses(result.data.agents);
        } catch {
          // ignore malformed messages
        }
      });

      es.addEventListener("error", () => {
        // Close immediately so the browser does not auto-reconnect this EventSource;
        // our own timer below will create a fresh one after the delay.
        es?.close();
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, []);

  return statuses;
}
