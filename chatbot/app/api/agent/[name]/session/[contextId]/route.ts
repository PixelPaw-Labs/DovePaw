import { getSessionDetail } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string; contextId: string }> },
) {
  const { contextId } = await params;
  const detail = getSessionDetail(contextId);
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(detail);
}
