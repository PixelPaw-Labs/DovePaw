import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock settings lib before importing route ─────────────────────────────────

vi.mock("@@/lib/settings", () => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
}));

import { readSettings, writeSettings } from "@@/lib/settings";
import { GET, PUT } from "../settings/dove/route";

const BASE_SETTINGS = { version: 1 as const, repositories: [], envVars: [] };

const CUSTOM_DOVE = {
  displayName: "Kitty",
  tagline: "Your loyal helper.",
  persona: "I am a helpful assistant.",
  landingTitle: "Hi there!",
  landingDescription: "Ready to help.",
  avatarUrl: "/uploads/dove-avatar.jpg",
  iconName: "Cat",
  iconBg: "bg-pink-100",
  iconColor: "text-pink-700",
  defaultModel: "",
  doveMode: "supervised" as const,
  allowWebTools: false,
  behaviorReminder: "",
  subAgentBehaviorReminder: "",
};

beforeEach(() => {
  vi.mocked(readSettings).mockResolvedValue(BASE_SETTINGS);
  vi.mocked(writeSettings).mockResolvedValue();
});

describe("GET /api/settings/dove", () => {
  it("returns defaults when dove field is absent", async () => {
    const body = await (await GET()).json();
    expect(body.displayName).toBe("Dove");
    expect(body.avatarUrl).toBe("/dove-avatar.webp");
  });

  it("returns stored dove settings when present", async () => {
    vi.mocked(readSettings).mockResolvedValue({ ...BASE_SETTINGS, dove: CUSTOM_DOVE });
    const body = await (await GET()).json();
    expect(body.displayName).toBe("Kitty");
    expect(body.iconName).toBe("Cat");
  });
});

describe("PUT /api/settings/dove", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/settings/dove", {
      method: "PUT",
      body: "not json",
    });
    const response = await PUT(req);
    expect(response.status).toBe(400);
  });

  it("returns 400 when body has wrong types", async () => {
    const req = new Request("http://localhost/api/settings/dove", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: 123 }),
    });
    const response = await PUT(req);
    expect(response.status).toBe(400);
  });

  it("saves dove settings and returns them", async () => {
    const req = new Request("http://localhost/api/settings/dove", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CUSTOM_DOVE),
    });

    const response = await PUT(req);
    expect(response.status).toBe(200);
    expect(vi.mocked(writeSettings)).toHaveBeenCalledOnce();

    const body = await response.json();
    expect(body.displayName).toBe("Kitty");
    expect(body.iconName).toBe("Cat");
  });

  it("merges dove field into existing settings on write", async () => {
    const req = new Request("http://localhost/api/settings/dove", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(CUSTOM_DOVE),
    });

    await PUT(req);

    const written = vi.mocked(writeSettings).mock.calls[0][0];
    expect(written.version).toBe(1);
    expect(written.repositories).toEqual([]);
    expect(written.dove?.displayName).toBe("Kitty");
  });
});
