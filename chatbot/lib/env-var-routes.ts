/**
 * Shared utilities for env-var route handlers (global and per-agent).
 */

import { z } from "zod";

export const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

/** Core env var fields shared across POST and PATCH schemas. */
export const envVarFields = {
  key: z.string().regex(ENV_KEY_RE, "Key must be SCREAMING_SNAKE_CASE (e.g. MY_TOKEN)"),
  value: z.string().default(""),
  isSecret: z.boolean().default(false),
  keychainService: z.string().optional(),
  keychainAccount: z.string().optional(),
};

/** Parse a JSON request body and validate it against a schema. Returns the parsed data or a 400 Response. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: Response.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: Response.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: parsed.data };
}

/** Build the updated env var object for a PATCH operation. */
export function buildUpdatedEnvVar(
  id: string,
  key: string,
  value: string,
  isSecret: boolean,
  keychainService?: string,
  keychainAccount?: string,
) {
  return {
    id,
    key: key.trim(),
    value: isSecret ? "" : value,
    isSecret,
    ...(keychainService ? { keychainService, keychainAccount: keychainAccount ?? key.trim() } : {}),
  };
}
