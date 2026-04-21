import { z } from "zod";
import { publishSessionEvent } from "@/lib/session-events";
import type { ChatSseEvent } from "@/lib/chat-sse";

const bodySchema = z.object({
  sessionId: z.string(),
  event: z.object({ type: z.string() }).passthrough(),
});

export async function POST(request: Request) {
  const { sessionId, event } = bodySchema.parse(await request.json());
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- caller owns the event shape
  publishSessionEvent(sessionId, event as ChatSseEvent);
  return Response.json({ ok: true });
}
