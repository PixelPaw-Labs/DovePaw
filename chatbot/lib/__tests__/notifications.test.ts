import { describe, expect, it, vi } from "vitest";
import { buildNotificationHooks, sendNotification } from "../notifications";
import type { AgentNotificationConfig } from "@@/lib/settings-schemas";

const ntfyChannel: AgentNotificationConfig["channel"] = {
  type: "ntfy",
  topic: "my-topic",
  server: "https://ntfy.sh",
};

const baseConfig: AgentNotificationConfig = {
  enabled: true,
  onSessionStart: true,
  onSessionEnd: true,
  channel: ntfyChannel,
};

// ─── buildNotificationHooks ───────────────────────────────────────────────────

describe("buildNotificationHooks", () => {
  it("returns empty object when disabled", () => {
    const hooks = buildNotificationHooks("My Agent", { ...baseConfig, enabled: false });
    expect(hooks).toEqual({});
  });

  it("omits SessionStart when onSessionStart is false", () => {
    const hooks = buildNotificationHooks("My Agent", { ...baseConfig, onSessionStart: false });
    expect(hooks.SessionStart).toBeUndefined();
    expect(hooks.SessionEnd).toBeDefined();
  });

  it("omits SessionEnd when onSessionEnd is false", () => {
    const hooks = buildNotificationHooks("My Agent", { ...baseConfig, onSessionEnd: false });
    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.SessionEnd).toBeUndefined();
  });

  it("includes both hooks when both are enabled", () => {
    const hooks = buildNotificationHooks("My Agent", baseConfig);
    expect(hooks.SessionStart).toHaveLength(1);
    expect(hooks.SessionEnd).toHaveLength(1);
  });

  it("resolves $VAR topic from env", () => {
    const config: AgentNotificationConfig = {
      ...baseConfig,
      channel: { type: "ntfy", topic: "$NTFY_TOPIC", server: "https://ntfy.sh" },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const hooks = buildNotificationHooks("Agent", config, { NTFY_TOPIC: "resolved-topic" });

    // Invoke the SessionStart hook to confirm resolved topic is used
    const matcher = hooks.SessionStart?.[0];
    expect(matcher).toBeDefined();
    void matcher?.hooks[0]?.({ hook_event_name: "SessionStart" } as never);

    // fetch is called with the resolved topic in the URL
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("resolved-topic"),
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });

  it("resolves ${VAR} topic from env", () => {
    const config: AgentNotificationConfig = {
      ...baseConfig,
      channel: { type: "ntfy", topic: "${NTFY_TOPIC}", server: "https://ntfy.sh" },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    buildNotificationHooks("Agent", config, { NTFY_TOPIC: "braces-topic" });
    // Invoke hook
    const hooks = buildNotificationHooks("Agent", config, { NTFY_TOPIC: "braces-topic" });
    void hooks.SessionStart?.[0]?.hooks[0]?.({ hook_event_name: "SessionStart" } as never);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("braces-topic"),
      expect.any(Object),
    );

    vi.unstubAllGlobals();
  });

  it("leaves plain topic unchanged when no env match", () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const hooks = buildNotificationHooks("Agent", baseConfig, {});
    void hooks.SessionStart?.[0]?.hooks[0]?.({ hook_event_name: "SessionStart" } as never);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("my-topic"), expect.any(Object));

    vi.unstubAllGlobals();
  });

  describe("SessionEnd hook", () => {
    it("uses priority 3 for normal exit reasons", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("Agent", { ...baseConfig, onSessionStart: false });
      const hookFn = hooks.SessionEnd?.[0]?.hooks[0];
      await hookFn?.({ hook_event_name: "SessionEnd", reason: "other" } as never);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ Priority: "3" }) }),
      );

      vi.unstubAllGlobals();
    });

    it("uses priority 4 for error exit reasons", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("Agent", { ...baseConfig, onSessionStart: false });
      const hookFn = hooks.SessionEnd?.[0]?.hooks[0];
      await hookFn?.({ hook_event_name: "SessionEnd", reason: "error" } as never);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ Priority: "4" }) }),
      );

      vi.unstubAllGlobals();
    });

    it("returns continue:true", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

      const hooks = buildNotificationHooks("Agent", { ...baseConfig, onSessionStart: false });
      const result = await hooks.SessionEnd?.[0]?.hooks[0]?.({
        hook_event_name: "SessionEnd",
        reason: "other",
      } as never);

      expect(result).toEqual({ continue: true });
      vi.unstubAllGlobals();
    });

    it("ignores non-SessionEnd events", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("Agent", { ...baseConfig, onSessionStart: false });
      const result = await hooks.SessionEnd?.[0]?.hooks[0]?.({
        hook_event_name: "SessionStart",
      } as never);

      expect(result).toEqual({ continue: true });
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });
});

// ─── sendNotification ─────────────────────────────────────────────────────────

describe("sendNotification", () => {
  it("POSTs to ntfy server with correct headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await sendNotification(ntfyChannel, "My Title", "My message", 3);

    expect(fetchMock).toHaveBeenCalledWith("https://ntfy.sh/my-topic", {
      method: "POST",
      headers: { Title: "My Title", Priority: "3", "Content-Type": "text/plain" },
      body: "My message",
    });

    vi.unstubAllGlobals();
  });

  it("swallows fetch errors silently", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    await expect(sendNotification(ntfyChannel, "t", "m")).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});
