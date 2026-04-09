/** A progress message with any artifacts published alongside it. */
export type ProgressEntry = {
  message: string;
  /** Artifacts linked to this progress message — name → text. */
  artifacts: Record<string, string>;
};

/**
 * Merge a single progress entry into a mutable array by message key (last-write-wins).
 * Skips empty message strings (used by terminal publishStatusToUI calls).
 */
export function upsertProgressEntry(
  progress: ProgressEntry[],
  message: string,
  artifacts: Record<string, string>,
): void {
  if (!message) return;
  const idx = progress.findLastIndex((e) => e.message === message);
  if (idx >= 0) {
    progress[idx] = { ...progress[idx], artifacts: { ...progress[idx].artifacts, ...artifacts } };
  } else {
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
 * - All existing keys present in incoming → update in place (covers superset arrival
 *   and same-structure updates e.g. label replaced by onTaskProgress)
 * - Different artifact key sets (parallel tickets with same step label) → append
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
      if (Object.keys(match.artifacts).every((k) => k in entry.artifacts)) {
        merged[matchIdx] = { ...match, artifacts: { ...match.artifacts, ...entry.artifacts } };
        continue;
      }
    }
    merged.push(entry);
  }
  return merged;
}
