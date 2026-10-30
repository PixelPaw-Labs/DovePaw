import { answerUnattendedPermission, isAddonApprovalAsk } from "./addon-approval.js";

type CanUseToolOptions = Parameters<typeof answerUnattendedPermission>[2];

function makeOptions(overrides: Partial<CanUseToolOptions> = {}): CanUseToolOptions {
  return {
    signal: new AbortController().signal,
    toolUseID: "toolu_test",
    requestId: "req_test",
    ...overrides,
  };
}

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

describe("answerUnattendedPermission", () => {
  const input = { skill: "stop-slop" };

  it("allows an add-on approval ask with the original input", async () => {
    const result = await answerUnattendedPermission(
      "Skill",
      input,
      makeOptions({ decisionReason: "skill stop-slop has never been approved on this laptop" }),
    );
    expect(result).toEqual({ behavior: "allow", updatedInput: input });
  });

  it("denies an add-on approval ask forced by a user ask rule", async () => {
    const result = await answerUnattendedPermission(
      "Skill",
      input,
      makeOptions({
        decisionReason: "skill stop-slop has never been approved on this laptop",
        matchedAskRule: { source: "userSettings", toolName: "Skill" },
      }),
    );
    expect(result).toEqual({
      behavior: "deny",
      message: "skill stop-slop has never been approved on this laptop",
    });
  });

  it("denies any other ask with its reason", async () => {
    const result = await answerUnattendedPermission(
      "Bash",
      { command: "rm -rf /tmp/x" },
      makeOptions({ decisionReason: "Bash command needs approval" }),
    );
    expect(result).toEqual({ behavior: "deny", message: "Bash command needs approval" });
  });

  it("denies an ask with no reason", async () => {
    const result = await answerUnattendedPermission("Write", {}, makeOptions());
    expect(result).toEqual({
      behavior: "deny",
      message: "Nobody is available to approve this tool call",
    });
  });
});
