import { getSessionDetail } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string; id: string }> },
) {
  const { id } = await params;
  const detail = getSessionDetail(id);
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(detail);
}
