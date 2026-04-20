"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "./use-messages";
import type { ChatSseEvent } from "@/lib/chat-sse";
import {
  activeSessionUrl,
  sessionDetailUrl,
  agentChatUrl,
  sessionStreamUrl,
  type AgentId,
} from "@/lib/agent-api-urls";
import { readSseStream } from "./read-sse-stream";
import { activeSessionResponseSchema, fetchSessionDetail } from "./session-api-client";
import { processActiveStreamEvent } from "./process-stream-event";

interface MemberState {
  sessionId: string | null;
  abort: AbortController | null;
  pendingToolNameRef: { current: string | null };
}

/**
 * Stub that satisfies the useTextAnimation interface but writes synchronously
 * with a per-id buffer. A single shared animation would mix text across members
 * since useTextAnimation keeps one displayedRef/pendingRef pair.
 */
function createDirectAnimation(onUpdate: (id: string, content: string) => void) {
  const buffers = new Map<string, string>();
  return {
    enqueue(id: string, chunk: string) {
      const next = (buffers.get(id) ?? "") + chunk;
      buffers.set(id, next);
      onUpdate(id, next);
    },
    flush(_id: string) {},
    cut(id: string) {
      buffers.set(id, "");
    },
    seed(id: string, text: string) {
      buffers.set(id, text);
    },
    reset() {
      buffers.clear();
    },
    stop() {},
  };
}

const noop = () => {};

interface GroupPoolEvent {
  agentId: string;
  text: string;
  type: "progress" | "done" | "error";
}

function parseGroupPoolEvent(raw: string): GroupPoolEvent | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowed above
    const p = parsed as Record<string, unknown>;
    if (typeof p.agentId !== "string" || typeof p.text !== "string" || typeof p.type !== "string")
      return null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- fields validated above
    return p as unknown as GroupPoolEvent;
  } catch {
    return null;
  }
}

async function readGroupStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: GroupPoolEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop -- streaming reads must be sequential
      const { done, value } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        const event = parseGroupPoolEvent(dataLine.slice(5).trim());
        if (event && event.text) onEvent(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Manages a merged message feed across multiple agents. Opens one SSE per
 * running member and fans events into a single messages array, each tagged
 * with agentId. Uses a per-id direct-write animation stub — simultaneous
 * streams cannot share a single animation queue.
 *
 * Also subscribes to the group A2A stream (via groupName) for live member
 * progress events and handles reconnection when the group chat is opened
 * mid-run.
 */
export function useGroupChatSession(memberAgentIds: string[], groupName: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const memberStateRef = useRef<Map<string, MemberState>>(
    new Map(
      memberAgentIds.map((id) => [
        id,
        { sessionId: null, abort: null, pendingToolNameRef: { current: null } },
      ]),
    ),
  );

  // Lazy-init so the animation's onUpdate closes over setMessages at the right time
  const animationRef = useRef<ReturnType<typeof createDirectAnimation> | null>(null);
  if (!animationRef.current) {
    animationRef.current = createDirectAnimation((id, content) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const segs = [...m.segments];
          let lastIdx = -1;
          for (let i = segs.length - 1; i >= 0; i--) {
            if (segs[i].type === "text") {
              lastIdx = i;
              break;
            }
          }
          if (lastIdx === -1) {
            return { ...m, segments: [...segs, { type: "text" as const, content }] };
          }
          segs[lastIdx] = { type: "text" as const, content };
          return { ...m, segments: segs };
        }),
      );
    });
  }

  const recomputeLoading = useCallback(() => {
    const anyActive = [...memberStateRef.current.values()].some((s) => s.abort !== null);
    setIsLoading(anyActive);
  }, []);

  const handleEvent = useCallback(
    (
      event: ChatSseEvent,
      assistantId: string,
      state: MemberState,
      skipResultIfHasText: boolean,
    ) => {
      if (event.type === "session") {
        state.sessionId = event.sessionId;
        return;
      }
      if (event.type === "progress") return;

      processActiveStreamEvent(
        event,
        assistantId,
        {
          updateActiveMessages: setMessages,
          animation: animationRef.current!,
          pendingToolNameRef: state.pendingToolNameRef,
          setPendingPermissions: noop,
          setPendingQuestions: noop,
          setSessionCancelled: noop,
        },
        { skipResultIfHasText },
      );
    },
    [],
  );

  const connectStream = useCallback(
    (agentId: string, sessionId: string, assistantId: string, resumeSeq: number) => {
      const state = memberStateRef.current.get(agentId);
      if (!state) return;
      state.abort?.abort();
      const abort = new AbortController();
      state.abort = abort;
      setIsLoading(true);

      void (async () => {
        try {
          const response = await fetch(`${sessionStreamUrl(sessionId)}?after=${resumeSeq}`, {
            signal: abort.signal,
          });
          if (!response.ok || !response.body) return;
          await readSseStream(response.body, (event) => {
            if (!abort.signal.aborted) handleEvent(event, assistantId, state, false);
          });
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
        } finally {
          if (state.abort === abort) state.abort = null;
          recomputeLoading();
        }
      })();
    },
    [handleEvent, recomputeLoading],
  );

  const sendToAgent = useCallback(
    async (agentId: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      const state = memberStateRef.current.get(agentId);
      if (!state) return;

      state.abort?.abort();
      const abort = new AbortController();
      state.abort = abort;

      const assistantId = crypto.randomUUID();

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          segments: [{ type: "text", content: trimmed }],
          agentId,
        },
        {
          id: assistantId,
          role: "assistant",
          segments: [{ type: "text", content: "" }],
          isLoading: true,
          agentId,
        },
      ]);
      setIsLoading(true);

      try {
        const response = await fetch(agentChatUrl(agentId as AgentId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, sessionId: state.sessionId }),
          signal: abort.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        await readSseStream(response.body!, (event) => {
          if (!abort.signal.aborted) handleEvent(event, assistantId, state, true);
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id !== assistantId
              ? m
              : {
                  ...m,
                  isLoading: false,
                  segments: [{ type: "text", content: `⚠️ Connection error: ${msg}` }],
                },
          ),
        );
      } finally {
        if (state.abort === abort) state.abort = null;
        recomputeLoading();
      }
    },
    [handleEvent, recomputeLoading],
  );

  // Poll for an active group session. Runs immediately on mount (reconnect)
  // and every 2 s thereafter (live discovery when Dove starts a new group task).
  useEffect(() => {
    let cancelled = false;
    let subscribedContextId: string | null = null;
    let groupStreamAbort: AbortController | null = null;

    const applyPoolEvent = (event: GroupPoolEvent) => {
      const agentMsgId = `pool-${event.agentId}`;
      const isDone = event.type === "done";
      setMessages((prev) => {
        const existing = prev.findIndex((m) => m.id === agentMsgId);
        if (existing !== -1) {
          return prev.map((m) =>
            m.id !== agentMsgId
              ? m
              : {
                  ...m,
                  isLoading: !isDone,
                  segments: [{ type: "text" as const, content: event.text }],
                },
          );
        }
        return [
          ...prev,
          {
            id: agentMsgId,
            role: "assistant" as const,
            segments: [{ type: "text" as const, content: event.text }],
            isLoading: !isDone,
            agentId: event.agentId,
          },
        ];
      });

      // When a member starts, connect its individual stream for live text deltas.
      // The mount effect only covers sessions already active — this handles tasks that
      // start after the group chat view is already open.
      if (event.type === "progress") {
        const state = memberStateRef.current.get(event.agentId);
        if (state && !state.abort) {
          void (async () => {
            const { id } = activeSessionResponseSchema.parse(
              await (await fetch(activeSessionUrl(event.agentId as AgentId))).json(),
            );
            if (!id || cancelled) return;
            const {
              messages: stamped,
              status,
              resumeSeq,
            } = await fetchSessionDetail(
              sessionDetailUrl(event.agentId as AgentId, id),
              event.agentId as AgentId,
            );
            if (status !== "running" || cancelled) return;
            const assistantId =
              stamped.toReversed().find((m) => m.role === "assistant")?.id ?? crypto.randomUUID();
            connectStream(event.agentId, id, assistantId, resumeSeq);
          })();
        }
      }
    };

    const subscribeGroupStream = (groupContextId: string) => {
      if (subscribedContextId === groupContextId) return;
      subscribedContextId = groupContextId;
      groupStreamAbort?.abort();
      const abort = new AbortController();
      groupStreamAbort = abort;
      setIsLoading(true);
      void (async () => {
        try {
          const res = await fetch(`/api/groups/stream/${encodeURIComponent(groupContextId)}`, {
            signal: abort.signal,
          });
          if (!res.ok || !res.body) return;
          await readGroupStream(res.body, abort.signal, (event) => {
            if (!cancelled) applyPoolEvent(event);
          });
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") return;
        } finally {
          if (groupStreamAbort === abort) {
            groupStreamAbort = null;
            subscribedContextId = null;
            recomputeLoading();
          }
        }
      })();
    };

    const checkGroupSession = async () => {
      if (cancelled || subscribedContextId) return;
      try {
        const res = await fetch(
          `/api/agent/${encodeURIComponent(`group:${groupName}`)}/active-session`,
        );
        if (!res.ok || cancelled) return;
        const body: unknown = await res.json();
        if (typeof body !== "object" || body === null) return;
        const { id, status } = body as { id?: string | null; status?: string };
        if (id && status === "running") subscribeGroupStream(id);
      } catch {
        // ignore network errors
      }
    };

    void checkGroupSession();
    const interval = setInterval(() => void checkGroupSession(), 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      groupStreamAbort?.abort();
    };
    // memberAgentIds and groupName are stable for the lifetime of the group view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const results = await Promise.allSettled(
        memberAgentIds.map(async (agentId) => {
          const state = memberStateRef.current.get(agentId);
          if (!state) return null;

          const { id } = activeSessionResponseSchema.parse(
            await (await fetch(activeSessionUrl(agentId as AgentId))).json(),
          );
          if (!id) return null;

          const detail = await fetchSessionDetail(
            sessionDetailUrl(agentId as AgentId, id),
            agentId as AgentId,
          );
          return { agentId, id, detail };
        }),
      );

      if (cancelled) return;

      const fulfilled = results
        .filter(
          (
            r,
          ): r is PromiseFulfilledResult<{
            agentId: string;
            id: string;
            detail: Awaited<ReturnType<typeof fetchSessionDetail>>;
          }> => r.status === "fulfilled" && r.value !== null,
        )
        .map((r) => r.value)
        .toSorted((a, b) => (a.detail.startedAt ?? "").localeCompare(b.detail.startedAt ?? ""));

      const allTagged = fulfilled.flatMap(({ agentId, detail: { messages: stamped } }) => {
        return stamped.map((m) => (m.agentId ? m : { ...m, agentId }));
      });

      if (allTagged.length > 0) {
        setMessages((prev) => [...prev, ...allTagged]);
      }

      for (const { agentId, id, detail } of fulfilled) {
        const state = memberStateRef.current.get(agentId);
        if (!state) continue;
        state.sessionId = id;
        const { messages: stamped, status, resumeSeq } = detail;
        if (status === "running") {
          const lastAssistant = stamped.toReversed().find((m) => m.role === "assistant");
          const assistantId = lastAssistant?.id ?? crypto.randomUUID();
          const resumeText =
            lastAssistant?.segments
              // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- narrowing MessageSegment union to text
              .filter((s): s is { type: "text"; content: string } => s.type === "text")
              .map((s) => s.content)
              .join("") ?? "";
          if (resumeText && resumeSeq > 0 && animationRef.current) {
            animationRef.current.seed(assistantId, resumeText);
          }
          connectStream(agentId, id, assistantId, resumeSeq);
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const state of memberStateRef.current.values()) {
        state.abort?.abort();
        state.abort = null;
      }
    };
    // Run once on mount; connectStream is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, isLoading, sendToAgent, clearMessages };
}
