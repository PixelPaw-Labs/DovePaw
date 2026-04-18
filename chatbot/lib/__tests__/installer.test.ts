// @vitest-environment node
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRm = vi.fn().mockResolvedValue(undefined);
const mockCp = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockSymlink = vi.fn().mockResolvedValue(undefined);

vi.mock("node:fs/promises", () => ({
  rm: mockRm,
  cp: mockCp,
  mkdir: mockMkdir,
  symlink: mockSymlink,
  access: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
  stat: vi.fn().mockResolvedValue({ mtime: new Date() }),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
  execSync: vi.fn().mockReturnValue(Buffer.from("501")),
}));

describe("deployAgentSdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("symlinks @openai/codex-sdk from repo node_modules into deployed sdk node_modules", async () => {
    const { deployAgentSdk } = await import("@@/lib/installer");
    const { AGENT_SDK_DIR, agentNodeModule } = await import("@@/lib/paths");

    await deployAgentSdk();

    const sdkNmScope = join(AGENT_SDK_DIR, "node_modules", "@openai");
    const expectedLink = join(sdkNmScope, "codex-sdk");
    const expectedTarget = agentNodeModule("@openai/codex-sdk");

    expect(mockMkdir).toHaveBeenCalledWith(sdkNmScope, { recursive: true });
    expect(mockSymlink).toHaveBeenCalledWith(expectedTarget, expectedLink);
  });

  it("writes package.json with type:module to ~/.dovepaw/tmp/ so tsx loads tmp agents as ESM", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { deployAgentSdk } = await import("@@/lib/installer");
    const { DOVEPAW_TMP_DIR } = await import("@@/lib/paths");

    await deployAgentSdk();

    expect(mockMkdir).toHaveBeenCalledWith(DOVEPAW_TMP_DIR, { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      join(DOVEPAW_TMP_DIR, "package.json"),
      '{"type":"module"}\n',
      "utf-8",
    );
  });
});
