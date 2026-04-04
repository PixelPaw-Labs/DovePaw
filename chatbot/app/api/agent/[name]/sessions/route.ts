import { readAgentsConfig } from "@@/lib/agents-config";
import { listSessions } from "@/lib/db";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const agent = (await readAgentsConfig()).find((a) => a.name === name);
  if (!agent) return Response.json({ error: `Agent '${name}' not found` }, { status: 404 });
  return Response.json({ sessions: listSessions(name) });
}
