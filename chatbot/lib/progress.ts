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
