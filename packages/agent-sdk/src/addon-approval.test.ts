import { isAddonApprovalAsk } from "./addon-approval.js";

describe("isAddonApprovalAsk", () => {
  it("matches an add-on that has never been approved", () => {
    expect(isAddonApprovalAsk("skill stop-slop has never been approved on this laptop")).toBe(true);
  });

  it("matches an add-on that changed since it was approved", () => {
    expect(
      isAddonApprovalAsk(
        "skill incident-io-oncall differs from the one you approved on 30 Oct 2026",
      ),
    ).toBe(true);
  });

  it("does not match an add-on that could not be identified", () => {
    expect(isAddonApprovalAsk("skill stop-slop could not be identified")).toBe(false);
  });

  it("does not match an unreadable approval catalog", () => {
    expect(
      isAddonApprovalAsk("skill stop-slop: the approval catalog on this laptop could not be read"),
    ).toBe(false);
  });

  it("does not match a missing reason", () => {
    expect(isAddonApprovalAsk(undefined)).toBe(false);
  });
});
