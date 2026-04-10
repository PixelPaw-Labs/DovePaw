"use client";

import type { ChatSseEvent } from "@/lib/chat-sse";

/**
 * Read an SSE response body line by line and call `onEvent` for each parsed
 * event. Callers are responsible for passing a signal-aborted fetch body —
 * AbortError propagates naturally out of reader.read() and should be caught
 * by the caller.
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ChatSseEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // eslint-disable-next-line no-await-in-loop -- streaming reader pattern requires sequential awaits
  while (true) {
    // eslint-disable-next-line no-await-in-loop -- streaming reader pattern requires sequential awaits
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data: ")) continue;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- JSON from trusted SSE stream
        const event = JSON.parse(line.slice(6)) as ChatSseEvent;
        onEvent(event);
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
}
