/**
 * GET  /api/settings/dove — Read Dove-specific settings with defaults applied
 * PUT  /api/settings/dove — Update Dove settings (partial update supported)
 */

import { readSettings, writeSettings } from "@@/lib/settings";
import { doveSettingsSchema, effectiveDoveSettings } from "@@/lib/settings-schemas";

export async function GET() {
  return Response.json(effectiveDoveSettings(await readSettings()));
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = doveSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const settings = await readSettings();
  settings.dove = parsed.data;
  await writeSettings(settings);

  return Response.json(parsed.data);
}
