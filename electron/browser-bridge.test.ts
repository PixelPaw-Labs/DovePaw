import { describe, expect, it } from "vitest";
import { parseFilesArg } from "./browser-bridge";

describe("parseFilesArg", () => {
  it("returns the files array when it is a non-empty list of strings", () => {
    expect(parseFilesArg({ files: ["/a.txt", "/b.txt"] })).toEqual(["/a.txt", "/b.txt"]);
  });

  it("throws when files is missing", () => {
    expect(() => parseFilesArg({})).toThrow(/non-empty array/);
  });

  it("throws when files is an empty array", () => {
    expect(() => parseFilesArg({ files: [] })).toThrow(/non-empty array/);
  });

  it("throws when files contains a non-string entry", () => {
    expect(() => parseFilesArg({ files: ["/a.txt", 42] })).toThrow(/non-empty array/);
  });

  it("throws when files is not an array", () => {
    expect(() => parseFilesArg({ files: "/a.txt" })).toThrow(/non-empty array/);
  });
});
