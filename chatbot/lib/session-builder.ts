import { randomUUID } from "node:crypto";
import type { SessionMessage } from "@/lib/message-types";

export function buildSessionMessages(
  userText: string,
  assistantMsg: SessionMessage,
): SessionMessage[] {
  return [
    { id: randomUUID(), role: "user", segments: [{ type: "text", content: userText }] },
    assistantMsg,
  ];
}
