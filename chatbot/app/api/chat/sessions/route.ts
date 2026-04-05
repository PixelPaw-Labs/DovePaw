import { listSessions, deleteSession } from "@/lib/db";
import { z } from "zod";

export async function GET() {
  return Response.json({ sessions: listSessions("dove") });
}

export async function DELETE(request: Request) {
  const { contextId } = z.object({ contextId: z.string() }).parse(await request.json());
  deleteSession(contextId);
  return Response.json({ ok: true });
}
