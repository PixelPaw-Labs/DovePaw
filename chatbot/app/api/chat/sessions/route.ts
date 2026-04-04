import { listSessions } from "@/lib/db";

export async function GET() {
  return Response.json({ sessions: listSessions("dove") });
}
