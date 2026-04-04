import { readAgentsConfig } from "@@/lib/agents-config";
import { readPortsManifest } from "@/a2a/lib/base-server";
import { z } from "zod";
import type { SessionInfo } from "@/lib/session-manager";

export type { SessionInfo };

const EMPTY = { sessions: [] as SessionInfo[] };

const sessionsSchema = z.array(
  z.object({ contextId: z.string(), startedAt: z.string(), label: z.string() }),
);

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  const agent = (await readAgentsConfig()).find((a) => a.name === name);
  if (!agent) return Response.json({ error: `Agent '${name}' not found` }, { status: 404 });

  const manifest = readPortsManifest();
  if (!manifest) return Response.json(EMPTY);

  const portValue = (manifest as Record<string, unknown>)[agent.manifestKey];
  if (typeof portValue !== "number") return Response.json(EMPTY);

  try {
    const res = await fetch(`http://localhost:${portValue}/sessions`, { cache: "no-store" });
    if (!res.ok) return Response.json(EMPTY);
    const parsed = sessionsSchema.safeParse(await res.json());
    const sessions = parsed.success ? parsed.data : [];
    return Response.json({ sessions });
  } catch {
    return Response.json(EMPTY);
  }
}
