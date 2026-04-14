/**
 * POST /api/chat/question
 *
 * Resolves a pending AskUserQuestion tool call from the Claude Agent SDK.
 * The browser sends this after the user selects answers in the question UI.
 */

import { z } from "zod";
import { resolvePendingQuestion } from "@/lib/pending-questions";

const questionResponseSchema = z.object({
  requestId: z.string(),
  answers: z.record(z.string(), z.string()),
});

export async function POST(request: Request) {
  const { requestId, answers } = questionResponseSchema.parse(await request.json());
  const resolved = resolvePendingQuestion(requestId, answers);
  if (!resolved) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
