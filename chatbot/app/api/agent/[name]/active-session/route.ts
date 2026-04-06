import { getActiveSession, setActiveSession } from "@/lib/db";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return Response.json({ id: getActiveSession(name) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const { id } = z.object({ id: z.string().nullable() }).parse(await request.json());
  setActiveSession(name, id);
  return Response.json({ ok: true });
}
