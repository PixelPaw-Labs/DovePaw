/** Artifact name constants — single source of truth for all A2A artifact names. */
export const ARTIFACT = {
  STREAM: "stream",
  THINKING: "thinking",
  TOOL_CALL: "tool-call",
  TOOL_INPUT: "tool-input",
  FINAL_OUTPUT: "final-output",
} as const;

/**
 * Artifact names that are streaming intermediaries — they carry content to the chat
 * bubble but must NOT be accumulated into workflow ProgressEntry nodes in
 * collectStreamResult. Only TOOL_CALL and FINAL_OUTPUT are structural enough to
 * warrant a workflow step; the rest are transient stream fragments.
 */
export const TRANSIENT_ARTIFACT_NAMES = new Set([
  ARTIFACT.STREAM,
  ARTIFACT.THINKING,
  ARTIFACT.TOOL_INPUT,
]);
