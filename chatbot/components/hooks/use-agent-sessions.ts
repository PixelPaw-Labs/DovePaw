"use client";

import { useState, useCallback, useEffect } from "react";
import { z } from "zod";
import { agentSessionsUrl } from "@/lib/agent-api-urls";

export interface AgentSession {
  id: string;
  startedAt: string; // ISO string from JSON serialisation of Date
  label: string;
  status: "running" | "done" | "cancelled";
}

const sessionStatusSchema = z.enum(["running", "done", "cancelled"]);

const sessionsResponseSchema = z.object({
  sessions: z.array(
    z.object({
      id: z.string(),
      startedAt: z.string(),
      label: z.string(),
      status: sessionStatusSchema.default("done"),
    }),
  ),
});

export async function parseSessions(res: Response): Promise<AgentSession[]> {
  const parsed = sessionsResponseSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.sessions : [];
}

export function useAgentSessions(agentId: string) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(agentSessionsUrl(agentId));
      if (!res.ok) return;
      setSessions(await parseSessions(res));
    } catch {
      // network error — leave sessions unchanged
    } finally {
      setIsLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    let current = true;
    setSessions([]);
    setIsLoading(true);
    fetch(agentSessionsUrl(agentId))
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
