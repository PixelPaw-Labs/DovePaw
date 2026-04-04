import { getActiveSession, setActiveSession } from "@/lib/db";
import { z } from "zod";

export async function GET() {
  return Response.json({ contextId: getActiveSession("dove") });
}

export async function PUT(request: Request) {
  const { contextId } = z.object({ contextId: z.string().nullable() }).parse(await request.json());
  setActiveSession("dove", contextId);
  return Response.json({ ok: true });
}
