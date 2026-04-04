import { getSessionDetail } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const detail = getSessionDetail(sessionId);
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(detail);
}
