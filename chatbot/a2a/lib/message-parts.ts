import type { Part } from "@a2a-js/sdk";

/** Extract the plain text instruction from an A2A user message's parts. */
export function extractInstruction(parts: Part[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.content?.$case === "text") texts.push(part.content.value);
  }
  return texts.join(" ").trim();
}
