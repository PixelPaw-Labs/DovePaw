import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Mock settings lib before importing route ─────────────────────────────────

vi.mock("@@/lib/settings", () => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
  makeEnvVar: vi.fn(
    (
      key: string,
      value: string,
      isSecret = false,
      keychainService?: string,
      keychainAccount?: string,
    ) => ({
      id: "test-id",
      key,
      value: isSecret ? "" : value,
      isSecret,
      ...(keychainService ? { keychainService, keychainAccount: keychainAccount ?? key } : {}),
    }),
  ),
  isDovepawManaged: vi.fn(
    (v: { isSecret: boolean; keychainService?: string }) => v.isSecret && !v.keychainService,
  ),
}));

vi.mock("@/lib/keyring", () => ({
  DOVEPAW_SERVICE: "dovepaw",
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));

import { readSettings, writeSettings } from "@@/lib/settings";
import { getSecret, setSecret, deleteSecret } from "@/lib/keyring";
import { GET, POST, PATCH, DELETE } from "../settings/env-vars/route";

const SAMPLE_SETTINGS = {
  version: 1 as const,
  repositories: [],
  envVars: [
    { id: "e1", key: "GITHUB_TOKEN", value: "", isSecret: true },
    { id: "e2", key: "SLACK_CHANNEL_ID", value: "C01234567", isSecret: false },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readSettings).mockResolvedValue(structuredClone(SAMPLE_SETTINGS));
  vi.mocked(writeSettings).mockResolvedValue();
  vi.mocked(getSecret).mockImplementation((_service, account) =>
    account === "GITHUB_TOKEN" ? "ghp_abc123" : null,
  );
  vi.mocked(setSecret).mockImplementation(() => {});
  vi.mocked(deleteSecret).mockImplementation(() => {});
});

describe("GET /api/settings/env-vars", () => {
  it("returns 200 with env vars list", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.envVars).toHaveLength(2);
  });

  it("populates secret value from keychain", async () => {
    const body = await (await GET()).json();
    const secret = body.envVars.find((v: { key: string }) => v.key === "GITHUB_TOKEN");
    expect(secret.value).toBe("ghp_abc123");
    expect(getSecret).toHaveBeenCalledWith("dovepaw", "GITHUB_TOKEN");
  });

  it("returns plain value directly for non-secret vars", async () => {
    const body = await (await GET()).json();
    const plain = body.envVars.find((v: { key: string }) => v.key === "SLACK_CHANNEL_ID");
    expect(plain.value).toBe("C01234567");
    expect(getSecret).not.toHaveBeenCalledWith("SLACK_CHANNEL_ID");
  });
});

describe("POST /api/settings/env-vars", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "POST",
      body: "not json",
    });
    expect((await POST(req)).status).toBe(400);
  });

  it("returns 400 when key is not SCREAMING_SNAKE_CASE", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "my_token", value: "abc" }),
    });
    expect((await POST(req)).status).toBe(400);
  });

  it("returns 409 when key already exists", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "GITHUB_TOKEN", value: "other" }),
    });
    expect((await POST(req)).status).toBe(409);
  });

  it("stores secret value in keychain, not in settings", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "NEW_SECRET", value: "s3cr3t", isSecret: true }),
    });
    const response = await POST(req);
    expect(response.status).toBe(201);
    expect(setSecret).toHaveBeenCalledWith("dovepaw", "NEW_SECRET", "s3cr3t");
    expect(writeSettings).toHaveBeenCalledOnce();
    const body = await response.json();
    const added = body.envVars.find((v: { key: string }) => v.key === "NEW_SECRET");
    expect(added.isSecret).toBe(true);
    expect(added.value).toBe(""); // value not in settings.json
  });

  it("stores plain value in settings, skips keychain", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "PLAIN_VAR", value: "hello", isSecret: false }),
    });
    const response = await POST(req);
    expect(response.status).toBe(201);
    expect(setSecret).not.toHaveBeenCalled();
  });

  it("links external keychain entry without writing to keychain", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "AWS_SECRET",
        value: "",
        isSecret: true,
        keychainService: "aws",
        keychainAccount: "default",
      }),
    });
    const response = await POST(req);
    expect(response.status).toBe(201);
    expect(setSecret).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/settings/env-vars", () => {
  function patchReq(body: object) {
    return new Request("http://localhost/api/settings/env-vars", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "PATCH",
      body: "not json",
    });
    expect((await PATCH(req)).status).toBe(400);
  });

  it("returns 404 when id does not exist", async () => {
    expect(
      (await PATCH(patchReq({ id: "nope", key: "FOO", value: "v", isSecret: false }))).status,
    ).toBe(404);
  });

  it("returns 409 when key conflicts with another var", async () => {
    expect(
      (await PATCH(patchReq({ id: "e1", key: "SLACK_CHANNEL_ID", value: "v", isSecret: false })))
        .status,
    ).toBe(409);
  });

  it("updates a non-secret var value in settings", async () => {
    const response = await PATCH(
      patchReq({ id: "e2", key: "SLACK_CHANNEL_ID", value: "new-val", isSecret: false }),
    );
    expect(response.status).toBe(200);
    expect(setSecret).not.toHaveBeenCalled();
    expect(deleteSecret).not.toHaveBeenCalled();
    expect(writeSettings).toHaveBeenCalledOnce();
  });

  it("updates secret value in keychain", async () => {
    const response = await PATCH(
      patchReq({ id: "e1", key: "GITHUB_TOKEN", value: "new-token", isSecret: true }),
    );
    expect(response.status).toBe(200);
    expect(deleteSecret).toHaveBeenCalledWith("dovepaw", "GITHUB_TOKEN");
    expect(setSecret).toHaveBeenCalledWith("dovepaw", "GITHUB_TOKEN", "new-token");
  });

  it("migrates secret → non-secret: removes from keychain, stores value in settings", async () => {
    await PATCH(patchReq({ id: "e1", key: "GITHUB_TOKEN", value: "plain-now", isSecret: false }));
    expect(deleteSecret).toHaveBeenCalledWith("dovepaw", "GITHUB_TOKEN");
    expect(setSecret).not.toHaveBeenCalled();
    const saved = vi.mocked(writeSettings).mock.calls[0][0];
    const updated = saved.envVars.find((v: { id: string }) => v.id === "e1")!;
    expect(updated.value).toBe("plain-now");
    expect(updated.isSecret).toBe(false);
  });

  it("migrates non-secret → secret: stores value in keychain, clears value in settings", async () => {
    await PATCH(patchReq({ id: "e2", key: "SLACK_CHANNEL_ID", value: "s3cr3t", isSecret: true }));
    expect(deleteSecret).not.toHaveBeenCalled();
    expect(setSecret).toHaveBeenCalledWith("dovepaw", "SLACK_CHANNEL_ID", "s3cr3t");
    const saved = vi.mocked(writeSettings).mock.calls[0][0];
    const updated = saved.envVars.find((v: { id: string }) => v.id === "e2")!;
    expect(updated.value).toBe("");
    expect(updated.isSecret).toBe(true);
  });

  it("handles key rename for a secret var", async () => {
    await PATCH(patchReq({ id: "e1", key: "GH_TOKEN", value: "tok", isSecret: true }));
    expect(deleteSecret).toHaveBeenCalledWith("dovepaw", "GITHUB_TOKEN");
    expect(setSecret).toHaveBeenCalledWith("dovepaw", "GH_TOKEN", "tok");
  });
});

describe("DELETE /api/settings/env-vars", () => {
  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "DELETE",
      body: "not json",
    });
    expect((await DELETE(req)).status).toBe(400);
  });

  it("returns 404 when id does not exist", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "nonexistent-id" }),
    });
    expect((await DELETE(req)).status).toBe(404);
  });

  it("deletes secret from keychain when removing a secret var", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "e1" }),
    });
    const response = await DELETE(req);
    expect(response.status).toBe(200);
    expect(deleteSecret).toHaveBeenCalledWith("dovepaw", "GITHUB_TOKEN");
    expect(writeSettings).toHaveBeenCalledOnce();
  });

  it("does not touch keychain when removing a non-secret var", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "e2" }),
    });
    await DELETE(req);
    expect(deleteSecret).not.toHaveBeenCalled();
  });

  it("does not delete linked external keychain entry on remove", async () => {
    vi.mocked(readSettings).mockResolvedValue({
      ...structuredClone(SAMPLE_SETTINGS),
      envVars: [
        {
          id: "e3",
          key: "AWS_SECRET",
          value: "",
          isSecret: true,
          keychainService: "aws",
          keychainAccount: "default",
        },
      ],
    });
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "e3" }),
    });
    await DELETE(req);
    expect(deleteSecret).not.toHaveBeenCalled();
  });

  it("removes the env var from the list", async () => {
    const req = new Request("http://localhost/api/settings/env-vars", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "e1" }),
    });
    const body = await (await DELETE(req)).json();
    expect(body.envVars).toHaveLength(1);
    expect(body.envVars[0].key).toBe("SLACK_CHANNEL_ID");
  });
});
