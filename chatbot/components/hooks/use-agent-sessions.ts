"use client";

import { useState, useCallback, useEffect } from "react";
import { z } from "zod";

export interface AgentSession {
  contextId: string;
  startedAt: string; // ISO string from JSON serialisation of Date
  label: string;
}

const sessionsResponseSchema = z.object({
  sessions: z.array(z.object({ contextId: z.string(), startedAt: z.string(), label: z.string() })),
});

async function parseSessions(res: Response): Promise<AgentSession[]> {
  const parsed = sessionsResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.sessions : [];
}

export function useAgentSessions(agentId: string) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async (id: string) => {
    if (id === "dove") {
      setSessions([]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`/api/agent/${id}/sessions`);
      if (!res.ok) return;
      setSessions(await parseSessions(res));
    } catch {
      // network error — leave sessions unchanged
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let current = true;
    if (agentId === "dove") {
      setSessions([]);
      return;
    }
    setIsLoading(true);
    fetch(`/api/agent/${agentId}/sessions`)
      .then((res) => (res.ok ? parseSessions(res) : Promise.resolve([])))
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
  }, [agentId]);

  return { sessions, isLoading, refresh };
}
