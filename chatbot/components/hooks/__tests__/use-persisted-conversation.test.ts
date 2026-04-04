import { beforeEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../use-messages";
import {
  STORAGE_KEY_ACTIVE,
  clearPersistedConversation,
  messagesKey,
  readActiveAgentId,
  readPersistedMessages,
  readPersistedSessionId,
  readSessionMessages,
  sessionKey,
  sessionMessagesKey,
  writeActiveAgentId,
  writePersistedMessages,
  writePersistedSessionId,
  writeSessionMessages,
  clearSessionMessages,
} from "../use-persisted-conversation";

function makeMessage(id: string, content: string): ChatMessage {
  return { id, role: "user", segments: [{ type: "text", content }] };
}

describe("use-persisted-conversation — key helpers", () => {
  it("messagesKey returns correct localStorage key", () => {
    expect(messagesKey("dove")).toBe("dovepaw:conv:dove:messages");
    expect(messagesKey("get-shit-done")).toBe("dovepaw:conv:get-shit-done:messages");
  });

  it("sessionKey returns correct localStorage key", () => {
    expect(sessionKey("dove")).toBe("dovepaw:conv:dove:sessionId");
  });

  it("sessionMessagesKey returns correct localStorage key", () => {
    expect(sessionMessagesKey("ctx-abc")).toBe("dovepaw:session:ctx-abc:messages");
  });

  it("STORAGE_KEY_ACTIVE is the active-agent key", () => {
    expect(STORAGE_KEY_ACTIVE).toBe("dovepaw:active");
  });
});

describe("use-persisted-conversation — activeAgentId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readActiveAgentId returns 'dove' when nothing stored", () => {
    expect(readActiveAgentId()).toBe("dove");
  });

  it("writeActiveAgentId + readActiveAgentId round-trips value", () => {
    writeActiveAgentId("get-shit-done");
    expect(readActiveAgentId()).toBe("get-shit-done");
  });

  it("readActiveAgentId returns 'dove' after writing empty string (fallback)", () => {
    localStorage.setItem(STORAGE_KEY_ACTIVE, "");
    expect(readActiveAgentId()).toBe("dove");
  });
});

describe("use-persisted-conversation — messages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readPersistedMessages returns null when nothing stored", () => {
    expect(readPersistedMessages("dove")).toBeNull();
  });

  it("writePersistedMessages + readPersistedMessages round-trips messages", () => {
    const msgs = [makeMessage("1", "hello"), makeMessage("2", "world")];
    writePersistedMessages("dove", msgs);
    expect(readPersistedMessages("dove")).toEqual(msgs);
  });

  it("readPersistedMessages returns null on malformed JSON", () => {
    localStorage.setItem(messagesKey("dove"), "not-valid-json{");
    expect(readPersistedMessages("dove")).toBeNull();
  });

  it("writePersistedMessages caps at 200 messages (keeps last 200)", () => {
    const msgs = Array.from({ length: 250 }, (_, i) => makeMessage(String(i), `msg ${i}`));
    writePersistedMessages("dove", msgs);
    const stored = readPersistedMessages("dove");
    expect(stored).toHaveLength(200);
    expect(stored![0].id).toBe("50"); // kept last 200 → start at index 50
    expect(stored![199].id).toBe("249");
  });

  it("writePersistedMessages stores per-agent (dove and get-shit-done are isolated)", () => {
    const doveMsg = [makeMessage("d1", "dove message")];
    const gsdMsg = [makeMessage("g1", "gsd message")];
    writePersistedMessages("dove", doveMsg);
    writePersistedMessages("get-shit-done", gsdMsg);
    expect(readPersistedMessages("dove")).toEqual(doveMsg);
    expect(readPersistedMessages("get-shit-done")).toEqual(gsdMsg);
  });

  it("readPersistedMessages returns empty array (not null) when stored as []", () => {
    writePersistedMessages("dove", []);
    expect(readPersistedMessages("dove")).toEqual([]);
  });
});

describe("use-persisted-conversation — sessionId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readPersistedSessionId returns null when nothing stored", () => {
    expect(readPersistedSessionId("dove")).toBeNull();
  });

  it("writePersistedSessionId + readPersistedSessionId round-trips value", () => {
    writePersistedSessionId("dove", "sess-abc");
    expect(readPersistedSessionId("dove")).toBe("sess-abc");
  });

  it("writePersistedSessionId(null) removes the key", () => {
    writePersistedSessionId("dove", "sess-xyz");
    writePersistedSessionId("dove", null);
    expect(readPersistedSessionId("dove")).toBeNull();
    expect(localStorage.getItem(sessionKey("dove"))).toBeNull();
  });

  it("stores sessionId per-agent", () => {
    writePersistedSessionId("dove", "sess-d");
    writePersistedSessionId("get-shit-done", "sess-g");
    expect(readPersistedSessionId("dove")).toBe("sess-d");
    expect(readPersistedSessionId("get-shit-done")).toBe("sess-g");
  });
});

describe("use-persisted-conversation — clearPersistedConversation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("removes messages and sessionId for the given agent", () => {
    writePersistedMessages("dove", [makeMessage("1", "hi")]);
    writePersistedSessionId("dove", "sess-1");
    clearPersistedConversation("dove");
    expect(readPersistedMessages("dove")).toBeNull();
    expect(readPersistedSessionId("dove")).toBeNull();
  });

  it("does not affect other agents", () => {
    writePersistedMessages("dove", [makeMessage("1", "hi")]);
    writePersistedMessages("get-shit-done", [makeMessage("2", "gsd")]);
    clearPersistedConversation("dove");
    expect(readPersistedMessages("get-shit-done")).toEqual([makeMessage("2", "gsd")]);
  });
});

describe("use-persisted-conversation — session-scoped messages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readSessionMessages returns null when nothing stored", () => {
    expect(readSessionMessages("ctx-1")).toBeNull();
  });

  it("writeSessionMessages + readSessionMessages round-trips value", () => {
    const msgs = [makeMessage("a", "hello")];
    writeSessionMessages("ctx-1", msgs);
    expect(readSessionMessages("ctx-1")).toEqual(msgs);
  });

  it("stores messages under the contextId key, not the agent key", () => {
    writeSessionMessages("ctx-1", [makeMessage("a", "hi")]);
    expect(localStorage.getItem(sessionMessagesKey("ctx-1"))).not.toBeNull();
    expect(localStorage.getItem(messagesKey("ctx-1"))).toBeNull();
  });

  it("clearSessionMessages removes the entry", () => {
    writeSessionMessages("ctx-2", [makeMessage("b", "bye")]);
    clearSessionMessages("ctx-2");
    expect(readSessionMessages("ctx-2")).toBeNull();
  });

  it("sessions are isolated by contextId", () => {
    writeSessionMessages("ctx-a", [makeMessage("1", "a")]);
    writeSessionMessages("ctx-b", [makeMessage("2", "b")]);
    clearSessionMessages("ctx-a");
    expect(readSessionMessages("ctx-b")).toEqual([makeMessage("2", "b")]);
  });
});
