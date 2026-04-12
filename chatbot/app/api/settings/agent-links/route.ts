/**
 * GET    /api/settings/agent-links  — List all agent communication links
 * POST   /api/settings/agent-links  — Create a link between two agents
 * PATCH  /api/settings/agent-links  — Update direction of an existing link
 * DELETE /api/settings/agent-links  — Remove a link between two agents
 *
 * Links are stored globally in ~/.dovepaw/agent-links.json, independent of
 * individual agent.json files.
 */

import { z } from "zod";
import { readAgentFile } from "@@/lib/agents-config";
import { readAgentLinks, writeAgentLinks, AGENT_LINK_STRATEGIES } from "@@/lib/agent-links";
import { parseBody } from "@/lib/env-var-routes";

export async function GET() {
  return Response.json({ links: readAgentLinks() });
}

const postBodySchema = z.object({
  source: z.string(),
  target: z.string(),
  direction: z.enum(["single", "dual"]),
  strategy: z.enum(AGENT_LINK_STRATEGIES).default("parallel"),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  const { source, target, direction, strategy } = parsed.data;

  if (source === target) {
    return Response.json({ error: "An agent cannot link to itself" }, { status: 400 });
  }

  const [sourceFile, targetFile] = await Promise.all([
    readAgentFile(source),
    readAgentFile(target),
  ]);
  if (!sourceFile) {
    return Response.json({ error: `Agent "${source}" not found` }, { status: 404 });
  }
  if (!targetFile) {
    return Response.json({ error: `Agent "${target}" not found` }, { status: 404 });
  }

  const links = readAgentLinks();
  const alreadyExists = links.some((l) => l.source === source && l.target === target);
  if (alreadyExists) {
    return Response.json(
      { error: `Link from "${source}" to "${target}" already exists` },
      { status: 409 },
    );
  }

  writeAgentLinks([...links, { source, target, direction, strategy }]);
  return Response.json({ ok: true }, { status: 201 });
}

const patchBodySchema = z.object({
  /** Identifies the existing link to replace. */
  source: z.string(),
  target: z.string(),
  /** New values — all fields required (full replace). */
  newSource: z.string(),
  newTarget: z.string(),
  direction: z.enum(["single", "dual"]),
  strategy: z.enum(AGENT_LINK_STRATEGIES).default("parallel"),
});

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const { source, target, newSource, newTarget, direction, strategy } = parsed.data;

  if (newSource === newTarget) {
    return Response.json({ error: "An agent cannot link to itself" }, { status: 400 });
  }

  const links = readAgentLinks();
  const idx = links.findIndex((l) => l.source === source && l.target === target);
  if (idx === -1) {
    return Response.json(
      { error: `Link from "${source}" to "${target}" not found` },
      { status: 404 },
    );
  }

  // Guard against creating a duplicate if source/target changed
  if (
    (newSource !== source || newTarget !== target) &&
    links.some((l, i) => i !== idx && l.source === newSource && l.target === newTarget)
  ) {
    return Response.json(
      { error: `Link from "${newSource}" to "${newTarget}" already exists` },
      { status: 409 },
    );
  }

  links[idx] = { source: newSource, target: newTarget, direction, strategy };
  writeAgentLinks(links);
  return Response.json({ ok: true });
}

const deleteBodySchema = z.object({
  source: z.string(),
  target: z.string(),
});

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const { source, target } = parsed.data;
  const links = readAgentLinks();
  // Remove the exact link entry — direction is stored once, no per-file cleanup needed
  writeAgentLinks(links.filter((l) => !(l.source === source && l.target === target)));
  return Response.json({ ok: true });
}
