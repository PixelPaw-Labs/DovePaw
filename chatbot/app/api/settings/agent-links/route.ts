/**
 * GET    /api/settings/agent-links  — List all agent communication links and groups
 * POST   /api/settings/agent-links  — Create a link between two agents
 * PATCH  /api/settings/agent-links  — Update an existing link (full replace)
 * DELETE /api/settings/agent-links  — Remove a link between two agents
 *
 * Links are stored globally in ~/.dovepaw/agent-links.json, independent of
 * individual agent.json files.
 */

import { z } from "zod";
import { readAgentFile } from "@@/lib/agents-config";
import { readAgentLinksFile, writeAgentLinksFile, AGENT_LINK_STRATEGIES } from "@@/lib/agent-links";
import { parseBody } from "@/lib/env-var-routes";

export async function GET() {
  const file = await readAgentLinksFile();
  return Response.json({ links: file.links, groups: file.groups });
}

const postBodySchema = z.object({
  source: z.string(),
  target: z.string(),
  direction: z.enum(["single", "dual"]),
  strategy: z.enum(AGENT_LINK_STRATEGIES).default("chat"),
  group: z.string().optional(),
  handoffScoreMin: z.number().min(0).max(100).default(80).optional(),
  handoffScoreMax: z.number().min(0).max(100).default(100).optional(),
});

export async function POST(request: Request) {
  const parsed = await parseBody(request, postBodySchema);
  if (!parsed.ok) return parsed.response;

  const { source, target, direction, strategy, group, handoffScoreMin, handoffScoreMax } =
    parsed.data;

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

  const file = await readAgentLinksFile();
  const alreadyExists = file.links.some(
    (l) => l.source === source && l.target === target && l.strategy === strategy,
  );
  if (alreadyExists) {
    return Response.json(
      { error: `Link from "${source}" to "${target}" with strategy "${strategy}" already exists` },
      { status: 409 },
    );
  }

  await writeAgentLinksFile({
    ...file,
    links: [
      ...file.links,
      {
        source,
        target,
        direction,
        strategy,
        group,
        handoffScoreMin: handoffScoreMin ?? 80,
        handoffScoreMax: handoffScoreMax ?? 100,
      },
    ],
  });
  return Response.json({ ok: true }, { status: 201 });
}

const patchBodySchema = z.object({
  /** Identifies the existing link to replace. */
  source: z.string(),
  target: z.string(),
  currentStrategy: z.enum(AGENT_LINK_STRATEGIES),
  /** New values — all fields required (full replace). */
  newSource: z.string(),
  newTarget: z.string(),
  direction: z.enum(["single", "dual"]),
  strategy: z.enum(AGENT_LINK_STRATEGIES).default("chat"),
  group: z.string().optional(),
  handoffScoreMin: z.number().min(0).max(100).default(80).optional(),
  handoffScoreMax: z.number().min(0).max(100).default(100).optional(),
});

export async function PATCH(request: Request) {
  const parsed = await parseBody(request, patchBodySchema);
  if (!parsed.ok) return parsed.response;

  const {
    source,
    target,
    currentStrategy,
    newSource,
    newTarget,
    direction,
    strategy,
    group,
    handoffScoreMin,
    handoffScoreMax,
  } = parsed.data;

  if (newSource === newTarget) {
    return Response.json({ error: "An agent cannot link to itself" }, { status: 400 });
  }

  const file = await readAgentLinksFile();
  const idx = file.links.findIndex(
    (l) => l.source === source && l.target === target && l.strategy === currentStrategy,
  );
  if (idx === -1) {
    return Response.json(
      {
        error: `Link from "${source}" to "${target}" with strategy "${currentStrategy}" not found`,
      },
      { status: 404 },
    );
  }

  // Guard against creating a duplicate if source/target/strategy changed
  if (
    (newSource !== source || newTarget !== target || strategy !== currentStrategy) &&
    file.links.some(
      (l, i) =>
        i !== idx && l.source === newSource && l.target === newTarget && l.strategy === strategy,
    )
  ) {
    return Response.json(
      {
        error: `Link from "${newSource}" to "${newTarget}" with strategy "${strategy}" already exists`,
      },
      { status: 409 },
    );
  }

  const updatedLinks = [...file.links];
  updatedLinks[idx] = {
    source: newSource,
    target: newTarget,
    direction,
    strategy,
    group,
    handoffScoreMin: handoffScoreMin ?? 80,
    handoffScoreMax: handoffScoreMax ?? 100,
  };
  await writeAgentLinksFile({ ...file, links: updatedLinks });
  return Response.json({ ok: true });
}

const deleteBodySchema = z.object({
  source: z.string(),
  target: z.string(),
  strategy: z.enum(AGENT_LINK_STRATEGIES),
});

export async function DELETE(request: Request) {
  const parsed = await parseBody(request, deleteBodySchema);
  if (!parsed.ok) return parsed.response;

  const { source, target, strategy } = parsed.data;
  const file = await readAgentLinksFile();
  await writeAgentLinksFile({
    ...file,
    links: file.links.filter(
      (l) => !(l.source === source && l.target === target && l.strategy === strategy),
    ),
  });
  return Response.json({ ok: true });
}
