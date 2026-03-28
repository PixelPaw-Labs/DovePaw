import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_ROOT, AGENTS_DIST } from "@@/lib/paths";

type Metafile = {
  outputs: Record<string, { imports: { path: string; external?: boolean }[] }>;
};

/**
 * Returns external packages required by a specific agent's bundle, using
 * esbuild's metafile (generated via `tsup --metafile`).
 * The metafile explicitly marks each import as external, making this
 * authoritative — covers static imports, dynamic imports, re-exports, and
 * side-effect imports without any string parsing.
 */
export function externalPackagesInBundle(
  agentName: string,
  { metafilePath, agentsRoot }: { metafilePath?: string; agentsRoot?: string } = {},
): string[] {
  const resolvedMetafile = metafilePath ?? join(AGENTS_DIST, "metafile-esm.json");
  const resolvedAgentsRoot = agentsRoot ?? AGENTS_ROOT;

  if (!existsSync(resolvedMetafile)) return [];

  const meta = JSON.parse(readFileSync(resolvedMetafile, "utf8")) as Metafile;

  const outputKey = Object.keys(meta.outputs).find((k) => k.endsWith(`${agentName}.mjs`));
  if (!outputKey) return [];

  const found = new Set<string>();
  for (const { path: spec, external } of meta.outputs[outputKey].imports) {
    if (!external) continue;
    // Normalise to package root: "@scope/name" or "name"
    const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    // Only include packages that exist in node_modules — excludes Node builtins (fs, path, etc.)
    // which appear in the metafile without the "node:" prefix
    if (existsSync(join(resolvedAgentsRoot, "node_modules", pkg))) {
      found.add(pkg);
    }
  }
  return [...found];
}
