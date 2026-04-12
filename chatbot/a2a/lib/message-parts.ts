/** Extract the plain text instruction from an A2A user message's parts. */
export function extractInstruction(parts: { kind: string; text?: string }[]): string {
  return parts
    .filter((p) => p.kind === "text")
    .map((p) => p.text ?? "")
    .join(" ")
    .trim();
}
