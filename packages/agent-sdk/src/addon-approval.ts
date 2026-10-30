import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";

const ADDON_APPROVAL_REASON_RES = [
  / has never been approved on this laptop$/,
  / differs from the one you approved on .+$/,
];

export function isAddonApprovalAsk(decisionReason: string | undefined): boolean {
  if (!decisionReason) return false;
  return ADDON_APPROVAL_REASON_RES.some((re) => re.test(decisionReason));
}

export const answerUnattendedPermission: CanUseTool = async (_toolName, input, options) => {
  if (!options.matchedAskRule && isAddonApprovalAsk(options.decisionReason)) {
    return { behavior: "allow", updatedInput: input };
  }
  return {
    behavior: "deny",
    message: options.decisionReason ?? "Nobody is available to approve this tool call",
  };
};
