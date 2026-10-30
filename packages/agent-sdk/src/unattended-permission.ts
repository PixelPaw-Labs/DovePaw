import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { isAddonApprovalAsk } from "./addon-approval.js";

export const answerUnattendedPermission: CanUseTool = async (_toolName, input, options) => {
  if (!options.matchedAskRule && isAddonApprovalAsk(options.decisionReason)) {
    return { behavior: "allow", updatedInput: input };
  }
  return {
    behavior: "deny",
    message: options.decisionReason ?? "Nobody is available to approve this tool call",
  };
};
