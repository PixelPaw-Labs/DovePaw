/**
 * GET    /api/settings/group-env-vars?groupName=xxx — List per-group env vars (secrets resolved)
 * POST   /api/settings/group-env-vars — Add a per-group env var
 * PATCH  /api/settings/group-env-vars — Update a per-group env var
 * DELETE /api/settings/group-env-vars — Remove a per-group env var by id
 */

import { z } from "zod";
import { makeEnvVar, isDovepawManaged } from "@@/lib/settings";
import type { EnvVar } from "@@/lib/settings-schemas";
import { getSecret, setSecret, deleteSecret } from "@/lib/keyring";
import { readOrCreateGroupConfig, patchGroupConfig } from "@@/lib/group-config";
import { envVarFields, parseBody, buildUpdatedEnvVar } from "@/lib/env-var-routes";

function groupKeychainService(groupName: string) {
  return `dovepaw-group-${groupName}`;
}

function resolveCoords(v: EnvVar, groupName: string) {
  return {
    service: v.keychainService ?? groupKeychainService(groupName),
    account: v.keychainAccount ?? v.key,
  };
}

const querySchema = z.object({ groupName: z.string() });

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ groupName: searchParams.get("groupName") });
  if (!parsed.success) {
    return Response.json({ error: "Missing groupName query parameter" }, { status: 400 });
  }
  const { groupName } = parsed.data;
  const config = readOrCreateGroupConfig(groupName);
  return Response.json({ envVars: config.envVars });
}

const postBodySchema = z.object({ groupName: z.string(), ...envVarFields });

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  const { groupName, key, value, isSecret, keychainService, keychainAccount } = parsed.data;
  const config = readOrCreateGroupConfig(groupName);

  if (config.envVars.some((v) => v.key === key)) {
    return Response.json(
      { error: `Environment variable "${key}" already exists for this group` },
      { status: 409 },
    );
  }

  if (isSecret && !keychainService) {
    setSecret(groupKeychainService(groupName), key, value);
  }

  const updated = {
    ...config,
    envVars: [
      ...config.envVars,
      makeEnvVar(key, value, isSecret, keychainService, keychainAccount),
    ],
  };
  patchGroupConfig(groupName, { envVars: updated.envVars });

  return Response.json({ envVars: updated.envVars }, { status: 201 });
}

const patchBodySchema = z.object({ groupName: z.string(), id: z.string(), ...envVarFields });

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const { groupName, id, key, value, isSecret, keychainService, keychainAccount } = parsed.data;
  const config = readOrCreateGroupConfig(groupName);
  const target = config.envVars.find((v) => v.id === id);

  if (!target) {
    return Response.json({ error: "Environment variable not found" }, { status: 404 });
  }

  if (config.envVars.some((v) => v.id !== id && v.key === key)) {
    return Response.json(
      { error: `Environment variable "${key}" already exists for this group` },
      { status: 409 },
    );
  }

  // Blank value for an existing dovepaw-managed secret = keep current keychain entry (just move it if key was renamed)
  if (isSecret && !keychainService && value === "" && isDovepawManaged(target)) {
    if (key !== target.key) {
      const { service, account } = resolveCoords(target, groupName);
      const existing = getSecret(service, account) ?? "";
      deleteSecret(service, account);
      if (existing !== "") setSecret(groupKeychainService(groupName), key, existing);
    }
  } else {
    if (isDovepawManaged(target)) {
      const { service, account } = resolveCoords(target, groupName);
      deleteSecret(service, account);
    }
    if (isSecret && !keychainService) {
      setSecret(groupKeychainService(groupName), key, value);
    }
  }

  const envVars = config.envVars.map((v) =>
    v.id === id
      ? buildUpdatedEnvVar(id, key, value, isSecret, keychainService, keychainAccount)
      : v,
  );
  patchGroupConfig(groupName, { envVars });

  return Response.json({ envVars });
}

const deleteBodySchema = z.object({ groupName: z.string(), id: z.string() });

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const { groupName, id } = parsed.data;
  const config = readOrCreateGroupConfig(groupName);
  const target = config.envVars.find((v) => v.id === id);

  if (!target) {
    return Response.json({ error: "Environment variable not found" }, { status: 404 });
  }

  if (isDovepawManaged(target)) {
    const { service, account } = resolveCoords(target, groupName);
    deleteSecret(service, account);
  }

  const envVars = config.envVars.filter((v) => v.id !== id);
  patchGroupConfig(groupName, { envVars });

  return Response.json({ envVars });
}
