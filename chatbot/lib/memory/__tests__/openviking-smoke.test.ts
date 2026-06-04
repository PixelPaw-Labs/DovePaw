import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPENVIKING_PORT_FILE } from "@@/lib/paths";

/**
 * Live smoke test for the OpenViking memory API that backs the injected-prompt
 * recall (`POST /api/v1/search/find`). Confirms the sidecar's data-plane
 * contract has not drifted on upgrade.
 *
 * Opt-in: run on demand against a known-good live sidecar with
 * `OPENVIKING_SMOKE=1 npm run chatbot:test`. It is excluded from the normal
 * suite / pre-commit because (a) it depends on volatile live state and (b)
 * other tests in the suite reboot the sidecar, which would race it. It also
 * skips if there is no sidecar port file, or dynamically if the port file is
 * present but the server is unreachable.
 */
function readSidecarPort(): number | null {
  try {
    const parsed = JSON.parse(readFileSync(OPENVIKING_PORT_FILE, "utf-8")) as { port?: unknown };
    return typeof parsed.port === "number" ? parsed.port : null;
  } catch {
    return null;
  }
}

const port = readSidecarPort();
const enabled = process.env.OPENVIKING_SMOKE === "1" && port !== null;

describe.skipIf(!enabled)("OpenViking memory API (live sidecar smoke test)", () => {
  it("POST /api/v1/search/find accepts {query,target_uri,limit} and returns a recall envelope", async (ctx) => {
    let res: Response;
    try {
      res = await fetch(`http://127.0.0.1:${port}/api/v1/search/find`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: "smoke test",
          target_uri: "viking://agent/memories",
          limit: 1,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      ctx.skip(); // port file present but sidecar not actually listening
      return;
    }

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; result?: { memories?: unknown } };
    expect(body.status).toBe("ok");
    expect(Array.isArray(body.result?.memories)).toBe(true);
  });
});
