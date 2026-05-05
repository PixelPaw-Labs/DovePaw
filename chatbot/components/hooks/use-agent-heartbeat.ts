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
