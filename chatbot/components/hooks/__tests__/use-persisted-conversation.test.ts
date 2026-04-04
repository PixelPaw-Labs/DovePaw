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

describe("use-persisted-conversation — activeAgentId (no-op stubs)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readActiveAgentId always returns 'dove'", () => {
    expect(readActiveAgentId()).toBe("dove");
  });

  it("writeActiveAgentId is a no-op — readActiveAgentId still returns 'dove'", () => {
    writeActiveAgentId("get-shit-done");
    expect(readActiveAgentId()).toBe("dove");
  });
});

describe("use-persisted-conversation — messages (no-op stubs)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readPersistedMessages always returns null", () => {
    expect(readPersistedMessages("dove")).toBeNull();
  });

  it("writePersistedMessages is a no-op — readPersistedMessages still returns null", () => {
    const msgs = [makeMessage("1", "hello"), makeMessage("2", "world")];
    writePersistedMessages("dove", msgs);
    expect(readPersistedMessages("dove")).toBeNull();
  });
});

describe("use-persisted-conversation — sessionId (no-op stubs)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readPersistedSessionId always returns null", () => {
    expect(readPersistedSessionId("dove")).toBeNull();
  });

  it("writePersistedSessionId is a no-op — readPersistedSessionId still returns null", () => {
    writePersistedSessionId("dove", "sess-abc");
    expect(readPersistedSessionId("dove")).toBeNull();
  });
});

describe("use-persisted-conversation — clearPersistedConversation (no-op stub)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clearPersistedConversation is a no-op — readPersistedMessages still returns null", () => {
    clearPersistedConversation("dove");
    expect(readPersistedMessages("dove")).toBeNull();
  });

  it("does not affect other agents — both still return null", () => {
    clearPersistedConversation("dove");
    expect(readPersistedMessages("get-shit-done")).toBeNull();
  });
});

describe("use-persisted-conversation — session-scoped messages (no-op stubs)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("readSessionMessages always returns null", () => {
    expect(readSessionMessages("ctx-1")).toBeNull();
  });

  it("writeSessionMessages is a no-op — readSessionMessages still returns null", () => {
    const msgs = [makeMessage("a", "hello")];
    writeSessionMessages("ctx-1", msgs);
    expect(readSessionMessages("ctx-1")).toBeNull();
  });

  it("clearSessionMessages is a no-op", () => {
    clearSessionMessages("ctx-2");
    expect(readSessionMessages("ctx-2")).toBeNull();
  });

  it("sessions are isolated by contextId — both return null", () => {
    writeSessionMessages("ctx-a", [makeMessage("1", "a")]);
    writeSessionMessages("ctx-b", [makeMessage("2", "b")]);
    clearSessionMessages("ctx-a");
    expect(readSessionMessages("ctx-b")).toBeNull();
  });
});
