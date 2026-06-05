/**
 * GET /api/openviking/version — reports the installed OpenViking version and
 * the latest published version, for the memory-provider settings page.
 *
 * `current` comes from the running sidecar's `/health` (so it reflects what is
 * actually live); `latest` comes from PyPI. Either may be null independently if
 * the sidecar is down or PyPI is unreachable — one failing never blocks the other.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { OPENVIKING_PORT_FILE } from "@@/lib/paths";

const portFileSchema = z.object({ port: z.number().int().positive() });
const healthSchema = z.object({ version: z.string() });
const pypiSchema = z.object({ info: z.object({ version: z.string() }) });

const PYPI_URL = "https://pypi.org/pypi/openviking/json";

export async function GET(): Promise<Response> {
  const [current, latest] = await Promise.all([readCurrentVersion(), readLatestVersion()]);
  return Response.json({ current, latest });
}

async function readCurrentVersion(): Promise<string | null> {
  try {
    const { port } = portFileSchema.parse(
      JSON.parse(await readFile(OPENVIKING_PORT_FILE, "utf-8")),
    );
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const parsed = healthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.version : null;
  } catch {
    return null;
  }
}

async function readLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch(PYPI_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const parsed = pypiSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.info.version : null;
  } catch {
    return null;
  }
}
