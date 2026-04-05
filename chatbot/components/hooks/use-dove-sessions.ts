"use client";

import { useState, useCallback, useEffect } from "react";
import { parseSessions } from "./use-agent-sessions";
import type { AgentSession } from "./use-agent-sessions";

async function fetchDoveSessions(): Promise<AgentSession[]> {
  const res = await fetch("/api/chat/sessions");
  if (!res.ok) return [];
  return parseSessions(res);
}

export function useDoveSessions(active: boolean) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setSessions(await fetchDoveSessions());
    } catch {
      // network error — leave sessions unchanged
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteDoveSession = useCallback(async (contextId: string) => {
    await fetch("/api/chat/sessions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contextId }),
    });
    setSessions((prev) => prev.filter((s) => s.contextId !== contextId));
  }, []);

  useEffect(() => {
    if (!active) return;
    let current = true;
    setIsLoading(true);
    fetchDoveSessions()
      .then((data) => {
        if (current) setSessions(data);
      })
      .catch(() => {})
      .finally(() => {
        if (current) setIsLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active]);

  return { sessions, isLoading, refresh, deleteDoveSession };
}
