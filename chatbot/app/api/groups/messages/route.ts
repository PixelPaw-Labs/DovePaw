import { getGroupMessages } from "@/lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("agentIds") ?? "";
  const agentIds = raw.split(",").filter(Boolean);
  return Response.json(getGroupMessages(agentIds));
}
