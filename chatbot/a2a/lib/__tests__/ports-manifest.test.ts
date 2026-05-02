import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockMkdirSync, mockWriteFileSync, mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
  },
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

vi.mock("@/lib/paths", () => ({ PORTS_FILE: "/fake/.dovepaw/.ports.json" }));

import { writePortsManifest, readPortsManifest } from "../ports-manifest";

describe("writePortsManifest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates the parent directory before writing", () => {
    writePortsManifest({ agent_one: 51001 });

    expect(mockMkdirSync).toHaveBeenCalledWith("/fake/.dovepaw", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "/fake/.dovepaw/.ports.json",
      expect.stringContaining('"agent_one": 51001'),
    );
  });

  it("includes updatedAt in the written manifest", () => {
    writePortsManifest({ agent_one: 51001 });

    const written = mockWriteFileSync.mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("readPortsManifest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(readPortsManifest()).toBeNull();
  });

  it("returns parsed manifest when file is valid", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ agent_one: 51001, updatedAt: "2026-01-01T00:00:00.000Z" }),
    );
    const result = readPortsManifest();
    expect(result?.agent_one).toBe(51001);
  });

  it("returns null when file contains invalid JSON", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("not json");
    expect(readPortsManifest()).toBeNull();
  });
});
