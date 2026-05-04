/**
 * GET    /api/settings/agent-env-vars?agentName=xxx — List per-agent env vars (secrets resolved from keychain)
 * POST   /api/settings/agent-env-vars — Add a per-agent env var override
 * PATCH  /api/settings/agent-env-vars — Update a per-agent env var override
 * DELETE /api/settings/agent-env-vars — Remove a per-agent env var override by id
 */

import { z } from "zod";
import {
  readAgentSettings,
  writeAgentSettings,
  makeEnvVar,
  isDovepawManaged,
} from "@@/lib/settings";
import type { EnvVar } from "@@/lib/settings-schemas";
import { getSecret, setSecret, deleteSecret } from "@/lib/keyring";
import { readAgentsConfig } from "@@/lib/agents-config";
import { envVarFields, parseBody, buildUpdatedEnvVar } from "@/lib/env-var-routes";

function agentKeychainService(agentName: string) {
  return `dovepaw-agent-${agentName}`;
}

function resolveCoords(v: EnvVar, agentName: string) {
  return {
    service: v.keychainService ?? agentKeychainService(agentName),
    account: v.keychainAccount ?? v.key,
  };
}

const querySchema = z.object({
  agentName: z.string(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ agentName: searchParams.get("agentName") });
  if (!parsed.success) {
    return Response.json({ error: "Missing agentName query parameter" }, { status: 400 });
  }
  const { agentName } = parsed.data;
  if (!(await readAgentsConfig()).find((a) => a.name === agentName)) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const settings = await readAgentSettings(agentName);
  return Response.json({ envVars: settings.envVars });
}

const postBodySchema = z.object({
  agentName: z.string(),
  ...envVarFields,
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentName, key, value, isSecret, keychainService, keychainAccount } = parsed.data;

  if (!(await readAgentsConfig()).find((a) => a.name === agentName)) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const settings = await readAgentSettings(agentName);

  if (settings.envVars.some((v) => v.key === key)) {
    return Response.json(
      { error: `Environment variable "${key}" already exists for this agent` },
      { status: 409 },
    );
  }

  if (isSecret && !keychainService) {
    setSecret(agentKeychainService(agentName), key, value);
  }

  settings.envVars = [
    ...settings.envVars,
    makeEnvVar(key, value, isSecret, keychainService, keychainAccount),
  ];
  await writeAgentSettings(agentName, settings);

  return Response.json({ envVars: settings.envVars }, { status: 201 });
}

const patchBodySchema = z.object({
  agentName: z.string(),
  id: z.string(),
  ...envVarFields,
});

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentName, id, key, value, isSecret, keychainService, keychainAccount } = parsed.data;

  if (!(await readAgentsConfig()).find((a) => a.name === agentName)) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const settings = await readAgentSettings(agentName);
  const target = settings.envVars.find((v) => v.id === id);

  if (!target) {
    return Response.json({ error: "Environment variable not found" }, { status: 404 });
  }

  if (settings.envVars.some((v) => v.id !== id && v.key === key)) {
    return Response.json(
      { error: `Environment variable "${key}" already exists for this agent` },
      { status: 409 },
    );
  }

  // Blank value for an existing dovepaw-managed secret = keep current keychain entry (just move it if key was renamed)
  if (isSecret && !keychainService && value === "" && isDovepawManaged(target)) {
    if (key !== target.key) {
      const { service, account } = resolveCoords(target, agentName);
      const existing = getSecret(service, account) ?? "";
      deleteSecret(service, account);
      if (existing !== "") setSecret(agentKeychainService(agentName), key, existing);
    }
  } else {
    // Remove old agent-managed keychain entry if we own it
    if (isDovepawManaged(target)) {
      const { service, account } = resolveCoords(target, agentName);
      deleteSecret(service, account);
    }
    if (isSecret && !keychainService) {
      setSecret(agentKeychainService(agentName), key, value);
    }
  }

  settings.envVars = settings.envVars.map((v) =>
    v.id === id
      ? buildUpdatedEnvVar(id, key, value, isSecret, keychainService, keychainAccount)
      : v,
  );
  await writeAgentSettings(agentName, settings);

  return Response.json({ envVars: settings.envVars });
}

const deleteBodySchema = z.object({
  agentName: z.string(),
  id: z.string(),
});

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentName, id } = parsed.data;

  if (!(await readAgentsConfig()).find((a) => a.name === agentName)) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const settings = await readAgentSettings(agentName);
  const target = settings.envVars.find((v) => v.id === parsed.data.id);

  if (!target) {
    return Response.json({ error: "Environment variable not found" }, { status: 404 });
  }

  if (isDovepawManaged(target)) {
    const { service, account } = resolveCoords(target, agentName);
    deleteSecret(service, account);
  }

  settings.envVars = settings.envVars.filter((v) => v.id !== id);
  await writeAgentSettings(agentName, settings);

  return Response.json({ envVars: settings.envVars });
}
