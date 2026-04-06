import { getActiveSession, setActiveSession } from "@/lib/db";
import { z } from "zod";

export async function GET() {
  return Response.json({ id: getActiveSession("dove") });
}

export async function PUT(request: Request) {
  const { id } = z.object({ id: z.string().nullable() }).parse(await request.json());
  setActiveSession("dove", id);
  return Response.json({ ok: true });
}
