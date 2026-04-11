"use client";

import * as React from "react";
import { statusMessageSchema } from "@/a2a/heartbeat-types";
import type { AgentStatus } from "@/a2a/heartbeat-types";

const RECONNECT_DELAY_MS = 3_000;
const PORT_POLL_MS = 10_000;

function useWsPort(): number | null {
  const [wsPort, setWsPort] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function fetchPort() {
      try {
        const res = await fetch("/api/ports");
        if (!res.ok || cancelled) return;
        const data: unknown = await res.json();
        if (typeof data === "object" && data !== null && "ws_port" in data) {
          const wsPortValue: unknown = Reflect.get(data, "ws_port");
          if (typeof wsPortValue === "number") {
            setWsPort(wsPortValue);
          }
        }
      } catch {
        // ignore — server not ready yet
      }
    }

    void fetchPort();
    const interval = setInterval(() => void fetchPort(), PORT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return wsPort;
}

export function useAgentHeartbeat(): Record<string, AgentStatus> {
  const [statuses, setStatuses] = React.useState<Record<string, AgentStatus>>({});
  const wsPort = useWsPort();

  React.useEffect(() => {
    if (wsPort === null) return () => {};

    const url = `ws://127.0.0.1:${wsPort}`;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      ws = new WebSocket(url);

      ws.addEventListener("message", (event) => {
        try {
          if (typeof event.data !== "string") return;
          const result = statusMessageSchema.safeParse(JSON.parse(event.data));
          if (result.success) setStatuses(result.data.agents);
        } catch {
          // ignore malformed messages
        }
      });

      ws.addEventListener("close", () => {
        if (!cancelled) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });

      ws.addEventListener("error", () => ws?.close());
    }

    connect();
    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [wsPort]);

  return statuses;
}
