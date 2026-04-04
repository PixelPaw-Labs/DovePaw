/**
 * GET    /api/settings/agent-config-files?agentName=xxx — list all config files for an agent
 * PUT    /api/settings/agent-config-files — create or update a config file
 * DELETE /api/settings/agent-config-files — delete a config file
 *
 * Files are stored at ~/.dovepaw/agents/config/<agentName>/<filename>.
 * Only .json filenames matching [a-zA-Z0-9][a-zA-Z0-9_\-]*.json are accepted.
 */

import { z } from "zod";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { readAgentsConfig } from "@@/lib/agents-config";
import { agentConfigDir, agentConfigFile } from "@@/lib/paths";
import { parseBody } from "@/lib/env-var-routes";

const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.json$/;

function listFiles(agentName: string): Array<{ name: string; content: string }> {
  const dir = agentConfigDir(agentName);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => FILENAME_RE.test(f))
    .map((name) => ({
      name,
      content: readFileSync(agentConfigFile(agentName, name), "utf-8"),
    }));
}

const querySchema = z.object({ agentName: z.string() });

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
  return Response.json({ files: listFiles(agentName) });
}

const putBodySchema = z.object({
  agentName: z.string(),
  filename: z
    .string()
    .regex(FILENAME_RE, "Filename must be alphanumeric with dashes/underscores, ending in .json"),
  content: z.string(),
});

export async function PUT(request: Request) {
  const parsed = await parseBody(request, putBodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentName, filename, content } = parsed.data;

  if (!(await readAgentsConfig()).find((a) => a.name === agentName)) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  try {
    JSON.parse(content);
  } catch {
    return Response.json({ error: "Content is not valid JSON" }, { status: 400 });
  }

  const dir = agentConfigDir(agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(agentConfigFile(agentName, filename), content, "utf-8");

  return Response.json({ files: listFiles(agentName) });
}

const deleteBodySchema = z.object({
  agentName: z.string(),
  filename: z.string().regex(FILENAME_RE),
});

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const { agentName, filename } = parsed.data;

  if (!(await readAgentsConfig()).find((a) => a.name === agentName)) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const path = agentConfigFile(agentName, filename);
  if (!existsSync(path)) {
    return Response.json({ error: "File not found" }, { status: 404 });
  }
  unlinkSync(path);

  return Response.json({ files: listFiles(agentName) });
}
