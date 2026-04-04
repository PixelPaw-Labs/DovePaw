import { getActiveSession, setActiveSession } from "@/lib/db";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return Response.json({ contextId: getActiveSession(name) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { contextId } = z.object({ contextId: z.string().nullable() }).parse(await request.json());
  setActiveSession(name, contextId);
  return Response.json({ ok: true });
}
