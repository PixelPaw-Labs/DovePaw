import { listSessions, deleteSession } from "@/lib/db";
import { z } from "zod";

export async function GET() {
  return Response.json({ sessions: listSessions("dove") });
}

export async function DELETE(request: Request) {
  const { id } = z.object({ id: z.string() }).parse(await request.json());
  await deleteSession(id);
  return Response.json({ ok: true });
}
