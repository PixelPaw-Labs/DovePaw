import { consola } from "consola";
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
    expect(
      buildNotificationHooks("test_agent", "Agent", { ...baseConfig, enabled: false }),
    ).toEqual({});
  });

  it("omits PreToolUse when onSessionStart is false", () => {
    const hooks = buildNotificationHooks("test_agent", "Agent", {
      ...baseConfig,
      onSessionStart: false,
    });
    expect(hooks.PreToolUse).toBeUndefined();
    expect(hooks.PostToolUse).toBeDefined();
  });

  it("omits PostToolUse when onSessionEnd is false", () => {
    const hooks = buildNotificationHooks("test_agent", "Agent", {
      ...baseConfig,
      onSessionEnd: false,
    });
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PostToolUse).toBeUndefined();
  });

  it("includes both when both flags enabled", () => {
    const hooks = buildNotificationHooks("test_agent", "Agent", baseConfig);
    expect(hooks.PreToolUse).toHaveLength(1);
    expect(hooks.PostToolUse).toHaveLength(1);
  });

  it("resolves $VAR topic from env", async () => {
    const config: AgentNotificationConfig = {
      ...baseConfig,
      onSessionEnd: false,
      channel: { type: "ntfy", topic: "$NTFY_TOPIC", server: "https://ntfy.sh" },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const hooks = buildNotificationHooks("test_agent", "Agent", config, {
      NTFY_TOPIC: "resolved-topic",
    });
    await hooks.PreToolUse?.[0]?.hooks[0]?.(
      { hook_event_name: "PreToolUse" } as never,
      undefined,
      {} as never,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("resolved-topic"),
      expect.any(Object),
    );
    vi.unstubAllGlobals();
  });

  it("resolves ${VAR} topic from env", async () => {
    const config: AgentNotificationConfig = {
      ...baseConfig,
      onSessionEnd: false,
      channel: { type: "ntfy", topic: "${NTFY_TOPIC}", server: "https://ntfy.sh" },
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const hooks = buildNotificationHooks("test_agent", "Agent", config, {
      NTFY_TOPIC: "braces-topic",
    });
    await hooks.PreToolUse?.[0]?.hooks[0]?.(
      { hook_event_name: "PreToolUse" } as never,
      undefined,
      {} as never,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("braces-topic"),
      expect.any(Object),
    );
    vi.unstubAllGlobals();
  });

  describe("PreToolUse (script start) hook", () => {
    it("fires notification on PreToolUse", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("test_agent", "My Agent", {
        ...baseConfig,
        onSessionEnd: false,
      });
      await hooks.PreToolUse?.[0]?.hooks[0]?.(
        { hook_event_name: "PreToolUse" } as never,
        undefined,
        {} as never,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("my-topic"),
        expect.objectContaining({ body: expect.stringContaining("Started at") }),
      );
      vi.unstubAllGlobals();
    });

    it("ignores non-PreToolUse events", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("test_agent", "Agent", {
        ...baseConfig,
        onSessionEnd: false,
      });
      const result = await hooks.PreToolUse?.[0]?.hooks[0]?.(
        {
          hook_event_name: "PostToolUse",
        } as never,
        undefined,
        {} as never,
      );

      expect(result).toEqual({ continue: true });
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("PostToolUse (script end) hook", () => {
    it("fires notification when status is completed", async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("test_agent", "My Agent", {
        ...baseConfig,
        onSessionStart: false,
      });
      await hooks.PostToolUse?.[0]?.hooks[0]?.(
        {
          hook_event_name: "PostToolUse",
          tool_response: { structuredContent: { status: "completed" } },
        } as never,
        undefined,
        {} as never,
      );

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("my-topic"),
        expect.objectContaining({ body: expect.stringContaining("Finished at") }),
      );
      vi.unstubAllGlobals();
    });

    it("does not fire when status is still_running", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("test_agent", "Agent", {
        ...baseConfig,
        onSessionStart: false,
      });
      await hooks.PostToolUse?.[0]?.hooks[0]?.(
        {
          hook_event_name: "PostToolUse",
          tool_response: { structuredContent: { status: "still_running", runId: "abc" } },
        } as never,
        undefined,
        {} as never,
      );

      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("does not fire when structuredContent is absent", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const hooks = buildNotificationHooks("test_agent", "Agent", {
        ...baseConfig,
        onSessionStart: false,
      });
      await hooks.PostToolUse?.[0]?.hooks[0]?.(
        {
          hook_event_name: "PostToolUse",
          tool_response: { content: [{ type: "text", text: "..." }] },
        } as never,
        undefined,
        {} as never,
      );

      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });

    it("returns continue:true", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

      const hooks = buildNotificationHooks("test_agent", "Agent", {
        ...baseConfig,
        onSessionStart: false,
      });
      const result = await hooks.PostToolUse?.[0]?.hooks[0]?.(
        {
          hook_event_name: "PostToolUse",
          tool_response: { structuredContent: { status: "completed" } },
        } as never,
        undefined,
        {} as never,
      );

      expect(result).toEqual({ continue: true });
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

  it("does not throw on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => {});
    await expect(sendNotification(ntfyChannel, "t", "m")).resolves.toBeUndefined();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("logs warning on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => {});
    await sendNotification(ntfyChannel, "t", "m");
    expect(warnSpy).toHaveBeenCalledWith("Notification failed:", "network error");
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("logs warning on HTTP error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "Forbidden" }),
    );
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => {});
    await sendNotification(ntfyChannel, "t", "m");
    expect(warnSpy).toHaveBeenCalledWith(
      "Notification failed:",
      "ntfy responded with 403: Forbidden",
    );
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("does not throw on HTTP error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "Server Error" }),
    );
    const warnSpy = vi.spyOn(consola, "warn").mockImplementation(() => {});
    await expect(sendNotification(ntfyChannel, "t", "m")).resolves.toBeUndefined();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
