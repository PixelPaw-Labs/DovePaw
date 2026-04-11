/** Strip leading/trailing whitespace and markdown code fences from LLM output. */
function stripCodeFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");
}

/**
 * Type-safe JSON.parse wrapper with validation.
 * Strips code fences, parses JSON, and validates with the provided type guard.
 * Returns the typed value or null if validation fails.
 */
export function parseJson<T>(text: string, guard: (v: unknown) => v is T): T | null {
  const cleaned = stripCodeFence(text);
  // Try full text first, then fall back to extracting the first JSON object.
  // LLM output often has prose before/after the JSON.
  for (const candidate of [cleaned, cleaned.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try {
      const data: unknown = JSON.parse(candidate);
      if (guard(data)) return data;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Parse JSON without validation — returns unknown.
 * Strips code fences before parsing.
 * Use when you need the raw parsed value and will narrow yourself.
 */
export function parseJsonRaw(text: string): unknown {
  return JSON.parse(stripCodeFence(text));
}
