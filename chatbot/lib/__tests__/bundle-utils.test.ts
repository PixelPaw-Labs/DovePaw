import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { externalPackagesInBundle } from "../bundle-utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMetafile(agentName: string, imports: { path: string; external: boolean }[]): object {
  return {
    outputs: {
      [`dist/${agentName}.mjs`]: { imports },
    },
  };
}

// ── Synthetic metafile tests ──────────────────────────────────────────────────

describe("externalPackagesInBundle (synthetic metafile)", () => {
  let tmpDir: string;
  let metafilePath: string;
  let agentsRoot: string;

  beforeAll(() => {
    tmpDir = join(tmpdir(), `bundle-utils-test-${Date.now()}`);
    agentsRoot = join(tmpDir, "agents");
    metafilePath = join(tmpDir, "metafile-esm.json");
    // Create fake node_modules for packages we consider "real" dependencies
    mkdirSync(join(agentsRoot, "node_modules", "@ladybugdb", "core"), { recursive: true });
    mkdirSync(join(agentsRoot, "node_modules", "some-pkg"), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when metafile does not exist", () => {
    const result = externalPackagesInBundle("get-shit-done", {
      metafilePath: join(tmpDir, "nonexistent.json"),
      agentsRoot,
    });
    expect(result).toEqual([]);
  });

  it("returns empty array when agent output not found in metafile", () => {
    writeFileSync(metafilePath, JSON.stringify(makeMetafile("other-agent", [])));
    const result = externalPackagesInBundle("get-shit-done", { metafilePath, agentsRoot });
    expect(result).toEqual([]);
  });

  it("returns empty array when agent has no external imports", () => {
    writeFileSync(
      metafilePath,
      JSON.stringify(
        makeMetafile("memory-dream", [
          { path: "fs", external: true },
          { path: "path", external: true },
          { path: "node:util", external: true },
        ]),
      ),
    );
    const result = externalPackagesInBundle("memory-dream", { metafilePath, agentsRoot });
    expect(result).toEqual([]);
  });

  it("excludes Node.js builtins (no node: prefix in metafile)", () => {
    writeFileSync(
      metafilePath,
      JSON.stringify(
        makeMetafile("get-shit-done", [
          { path: "fs", external: true },
          { path: "path", external: true },
          { path: "child_process", external: true },
          { path: "os", external: true },
        ]),
      ),
    );
    const result = externalPackagesInBundle("get-shit-done", { metafilePath, agentsRoot });
    expect(result).toEqual([]);
  });

  it("returns native packages that exist in node_modules", () => {
    writeFileSync(
      metafilePath,
      JSON.stringify(
        makeMetafile("get-shit-done", [
          { path: "fs", external: true },
          { path: "path", external: true },
          { path: "@ladybugdb/core", external: true },
        ]),
      ),
    );
    const result = externalPackagesInBundle("get-shit-done", { metafilePath, agentsRoot });
    expect(result).toEqual(["@ladybugdb/core"]);
  });

  it("deduplicates repeated imports of the same package", () => {
    writeFileSync(
      metafilePath,
      JSON.stringify(
        makeMetafile("get-shit-done", [
          { path: "@ladybugdb/core", external: true },
          { path: "@ladybugdb/core", external: true },
          { path: "@ladybugdb/core", external: true },
        ]),
      ),
    );
    const result = externalPackagesInBundle("get-shit-done", { metafilePath, agentsRoot });
    expect(result).toEqual(["@ladybugdb/core"]);
  });

  it("normalises scoped sub-path imports to package root", () => {
    mkdirSync(join(agentsRoot, "node_modules", "@scope", "pkg"), { recursive: true });
    writeFileSync(
      metafilePath,
      JSON.stringify(
        makeMetafile("get-shit-done", [{ path: "@scope/pkg/dist/index.js", external: true }]),
      ),
    );
    const result = externalPackagesInBundle("get-shit-done", { metafilePath, agentsRoot });
    expect(result).toEqual(["@scope/pkg"]);
  });

  it("skips non-external imports", () => {
    writeFileSync(
      metafilePath,
      JSON.stringify(
        makeMetafile("get-shit-done", [
          { path: "@ladybugdb/core", external: true },
          { path: "some-pkg", external: false },
        ]),
      ),
    );
    const result = externalPackagesInBundle("get-shit-done", { metafilePath, agentsRoot });
    expect(result).toEqual(["@ladybugdb/core"]);
  });
});

// ── Real metafile integration test ───────────────────────────────────────────

describe("externalPackagesInBundle (real metafile — all agents)", () => {
  const AGENTS_ROOT_REAL = join(import.meta.dirname, "../../..");
  const metafilePath = join(AGENTS_ROOT_REAL, "dist/metafile-esm.json");
  const opts = { metafilePath, agentsRoot: AGENTS_ROOT_REAL };

  const metafileHasGetShitDone =
    existsSync(metafilePath) &&
    Object.keys(JSON.parse(readFileSync(metafilePath, "utf8")).outputs).some((k) =>
      k.includes("get-shit-done"),
    );

  it.skipIf(!metafileHasGetShitDone)(
    "get-shit-done → [@ladybugdb/core] (only agent using the native dag store)",
    () => {
      expect(externalPackagesInBundle("get-shit-done", opts)).toContain("@ladybugdb/core");
    },
  );

  it.skipIf(!existsSync(metafilePath))("memory-dream → no native packages", () => {
    expect(externalPackagesInBundle("memory-dream", opts)).not.toContain("@ladybugdb/core");
  });

  it.skipIf(!existsSync(metafilePath))("oncall-analyzer → no native packages", () => {
    expect(externalPackagesInBundle("oncall-analyzer", opts)).not.toContain("@ladybugdb/core");
  });

  it.skipIf(!existsSync(metafilePath))("memory-distiller → no native packages", () => {
    expect(externalPackagesInBundle("memory-distiller", opts)).not.toContain("@ladybugdb/core");
  });

  it.skipIf(!existsSync(metafilePath))("release-log-sentinel → no native packages", () => {
    expect(externalPackagesInBundle("release-log-sentinel", opts)).not.toContain("@ladybugdb/core");
  });
});
