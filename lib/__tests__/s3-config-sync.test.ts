import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    send = mockSend;
  },
  PutObjectCommand: class {
    constructor(public args: unknown) {}
  },
}));

describe("pushConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockReset();
    delete process.env.S3_CONFIG_BUCKET;
  });

  it("is a no-op when S3_CONFIG_BUCKET is not set", async () => {
    const { pushConfig } = await import("../s3-config-sync.js");
    await pushConfig("settings.json", "{}");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("calls S3 PutObject when S3_CONFIG_BUCKET is set", async () => {
    process.env.S3_CONFIG_BUCKET = "test-bucket";
    mockSend.mockResolvedValue({});
    const { pushConfig } = await import("../s3-config-sync.js");
    await pushConfig("settings.json", '{"version":1}');
    expect(mockSend).toHaveBeenCalledOnce();
    const cmd = mockSend.mock.calls[0][0] as { args: Record<string, string> };
    expect(cmd.args.Bucket).toBe("test-bucket");
    expect(cmd.args.Key).toBe("settings.json");
    expect(cmd.args.Body).toBe('{"version":1}');
  });
});
