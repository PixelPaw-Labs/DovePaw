/**
 * GET  /api/settings — Read global settings (watched repositories, etc.)
 * PUT  /api/settings — Replace the repositories list; returns updated settings
 */

import { z } from "zod";
import { readSettings, writeSettings } from "@@/lib/settings";

export async function GET() {
  return Response.json(await readSettings());
}

const putBodySchema = z.object({
  repositories: z.array(z.object({ githubRepo: z.string() })),
});

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const settings = await readSettings();

  // Preserve existing IDs for repos that haven't changed (match by githubRepo slug).
  // Only generate a new UUID for genuinely new repos.
  const existingBySlug = new Map(settings.repositories.map((r) => [r.githubRepo, r]));
  settings.repositories = parsed.data.repositories.map((r) => {
    const trimmed = r.githubRepo.trim();
    return (
      existingBySlug.get(trimmed) ?? {
        id: crypto.randomUUID(),
        name: trimmed.split("/").at(-1) ?? trimmed,
        githubRepo: trimmed,
      }
    );
  });

  await writeSettings(settings);

  return Response.json(settings);
}
