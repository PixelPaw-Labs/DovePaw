import { describe, expect, it } from "vitest";
import { computeLoadFailureMessage } from "./load-error";

describe("computeLoadFailureMessage", () => {
  it("ignores subframe failures", () => {
    expect(computeLoadFailureMessage(-105, "ERR_NAME_NOT_RESOLVED", false)).toBeNull();
  });

  it("ignores ERR_ABORTED on the main frame (user navigated away mid-load)", () => {
    expect(computeLoadFailureMessage(-3, "ERR_ABORTED", true)).toBeNull();
  });

  it("returns the error description for a main-frame failure", () => {
    expect(computeLoadFailureMessage(-105, "ERR_NAME_NOT_RESOLVED", true)).toBe(
      "ERR_NAME_NOT_RESOLVED",
    );
  });

  it("falls back to a coded message when the description is empty", () => {
    expect(computeLoadFailureMessage(-105, "", true)).toBe("Failed to load (code -105)");
  });
});
