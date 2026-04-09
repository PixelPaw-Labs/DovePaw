/** A progress message with any artifacts published alongside it. */
export type ProgressEntry = {
  message: string;
  /** Artifacts linked to this progress message — name → text. */
  artifacts: Record<string, string>;
};

/**
 * Append a progress entry unless an exact (message + artifacts) duplicate already exists.
 * Skips empty message strings (used by terminal publishStatusToUI calls).
 *
 * Unlike name-only dedup, this allows parallel operations that share a step label
 * (e.g. concurrent repo clones all emitting "Cloning") to appear as distinct entries.
 */
export function upsertProgressEntry(
  progress: ProgressEntry[],
  message: string,
  artifacts: Record<string, string>,
): void {
  if (!message) return;
  const artifactsJson = JSON.stringify(artifacts);
  const alreadyExists = progress.some(
    (e) => e.message === message && JSON.stringify(e.artifacts) === artifactsJson,
  );
  if (!alreadyExists) {
    progress.push({ message, artifacts });
  }
}

/**
 * Merge two progress arrays for DB persistence (simple last-write-wins per message key).
 * Skips exact duplicates; spreads incoming artifacts over existing ones on match.
 */
export function mergeProgress(
  existing: ProgressEntry[],
  incoming: ProgressEntry[],
): ProgressEntry[] {
  const merged = [...existing];
  for (const entry of incoming) {
    const idx = merged.findLastIndex((e) => e.message === entry.message);
    if (idx >= 0) {
      const match = merged[idx];
      if (JSON.stringify(match.artifacts) === JSON.stringify(entry.artifacts)) continue;
      merged[idx] = { ...match, artifacts: { ...match.artifacts, ...entry.artifacts } };
    } else {
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Merge incoming live-stream progress entries into an existing list.
 * More conservative than mergeProgress — guards against stale replays and
 * parallel-ticket entries that share a step label but have different artifact key sets.
 *
 * - Exact duplicate → skip
 * - Incoming is a value-subset of existing → skip (stale replay)
 * - All existing keys present in incoming WITH matching values → update in place
 *   (enrichment: incoming adds new keys on top of an identical base, e.g. label added)
 * - Same or different artifact key sets but any existing value differs → append
 *   (different parallel operation that shares the same step label, e.g. two repo clones)
 * - No match → append
 */
export function mergeProgressEntries(
  existing: ProgressEntry[],
  incoming: ProgressEntry[],
): ProgressEntry[] {
  const merged = [...existing];
  for (const entry of incoming) {
    const incomingArtifactStr = JSON.stringify(entry.artifacts);
    let matchIdx = -1;
    for (let i = merged.length - 1; i >= 0; i--) {
      if (merged[i].message === entry.message) {
        matchIdx = i;
        break;
      }
    }
    if (matchIdx >= 0) {
      const match = merged[matchIdx];
      if (JSON.stringify(match.artifacts) === incomingArtifactStr) continue;
      if (Object.entries(entry.artifacts).every(([k, v]) => match.artifacts[k] === v)) continue;
      if (
        Object.keys(match.artifacts).every(
          (k) => k in entry.artifacts && match.artifacts[k] === entry.artifacts[k],
        )
      ) {
        merged[matchIdx] = { ...match, artifacts: { ...match.artifacts, ...entry.artifacts } };
        continue;
      }
    }
    merged.push(entry);
  }
  return merged;
}
