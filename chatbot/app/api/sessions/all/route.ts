import { deleteAllSessions } from "@/lib/db";

export async function DELETE() {
  deleteAllSessions();
  return Response.json({ ok: true });
}
