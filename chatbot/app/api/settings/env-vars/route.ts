/**
 * GET    /api/settings/env-vars — List all environment variables (secret values fetched from keychain)
 * POST   /api/settings/env-vars — Add a new environment variable
 * PATCH  /api/settings/env-vars — Update an existing environment variable
 * DELETE /api/settings/env-vars — Remove an environment variable by id
 */

import { z } from "zod";
import { readSettings, writeSettings, makeEnvVar, isDovepawManaged } from "@@/lib/settings";
import type { EnvVar } from "@@/lib/settings-schemas";
import { getSecret, setSecret, deleteSecret, DOVEPAW_SERVICE } from "@/lib/keyring";
import { envVarFields, parseBody, buildUpdatedEnvVar } from "@/lib/env-var-routes";

function resolveCoords(v: EnvVar) {
  return {
    service: v.keychainService ?? DOVEPAW_SERVICE,
    account: v.keychainAccount ?? v.key,
  };
}

export async function GET() {
  const settings = await readSettings();
  return Response.json({ envVars: settings.envVars });
}

const postBodySchema = z.object({
  ...envVarFields,
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  const settings = await readSettings();
  const { key, value, isSecret, keychainService, keychainAccount } = parsed.data;

  if (settings.envVars.some((v) => v.key === key)) {
    return Response.json(
      { error: `Environment variable "${key}" already exists` },
      { status: 409 },
    );
  }

  // Only write to keychain when dovepaw is managing the entry (no external service specified)
  if (isSecret && !keychainService) {
    setSecret(DOVEPAW_SERVICE, key, value);
  }

  settings.envVars = [
    ...settings.envVars,
    makeEnvVar(key, value, isSecret, keychainService, keychainAccount),
  ];
  await writeSettings(settings);

  return Response.json({ envVars: settings.envVars }, { status: 201 });
}

const patchBodySchema = z.object({
  id: z.string(),
  ...envVarFields,
});

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const settings = await readSettings();
  const { id, key, value, isSecret, keychainService, keychainAccount } = parsed.data;
  const target = settings.envVars.find((v) => v.id === id);

  if (!target) {
    return Response.json({ error: "Environment variable not found" }, { status: 404 });
  }

  if (settings.envVars.some((v) => v.id !== id && v.key === key)) {
    return Response.json(
      { error: `Environment variable "${key}" already exists` },
      { status: 409 },
    );
  }

  // Blank value for an existing dovepaw-managed secret = keep current keychain entry (just move it if key was renamed)
  if (isSecret && !keychainService && value === "" && isDovepawManaged(target)) {
    if (key !== target.key) {
      const { service, account } = resolveCoords(target);
      const existing = getSecret(service, account) ?? "";
      deleteSecret(service, account);
      if (existing !== "") setSecret(DOVEPAW_SERVICE, key, existing);
    }
  } else {
    // Remove the old dovepaw-managed entry if it was owned by us
    if (isDovepawManaged(target)) {
      const { service, account } = resolveCoords(target);
      deleteSecret(service, account);
    }
    // Write a new dovepaw-managed entry only when no external service is specified
    if (isSecret && !keychainService) {
      setSecret(DOVEPAW_SERVICE, key, value);
    }
  }

  settings.envVars = settings.envVars.map((v) =>
    v.id === id
      ? buildUpdatedEnvVar(id, key, value, isSecret, keychainService, keychainAccount)
      : v,
  );
  await writeSettings(settings);

  return Response.json({ envVars: settings.envVars });
}

const deleteBodySchema = z.object({
  id: z.string(),
});

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const settings = await readSettings();
  const target = settings.envVars.find((v) => v.id === parsed.data.id);

  if (!target) {
    return Response.json({ error: "Environment variable not found" }, { status: 404 });
  }

  // Only delete from keychain if dovepaw owns this entry
  if (isDovepawManaged(target)) {
    const { service, account } = resolveCoords(target);
    deleteSecret(service, account);
  }

  settings.envVars = settings.envVars.filter((v) => v.id !== parsed.data.id);
  await writeSettings(settings);

  return Response.json({ envVars: settings.envVars });
}
