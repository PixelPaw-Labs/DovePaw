/**
 * Group an unsorted list of repositories by their GitHub owner (the segment
 * before the first `/` in `githubRepo`). Owners and repos within each owner
 * are returned alphabetically. Repos without a slash are placed under an
 * empty-string owner group (rare; mostly a defensive case for malformed
 * entries).
 */
import type { Repository } from "@@/lib/settings-schemas";

export interface RepoOwnerGroup {
  owner: string;
  repos: Repository[];
}

export function groupReposByOwner(repos: Repository[]): RepoOwnerGroup[] {
  const byOwner = new Map<string, Repository[]>();
  for (const repo of repos) {
    const slash = repo.githubRepo.indexOf("/");
    const owner = slash === -1 ? "" : repo.githubRepo.slice(0, slash);
    const bucket = byOwner.get(owner);
    if (bucket) bucket.push(repo);
    else byOwner.set(owner, [repo]);
  }
  return [...byOwner.entries()]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([owner, bucket]) => ({
      owner,
      repos: bucket.toSorted((a, b) => a.githubRepo.localeCompare(b.githubRepo)),
    }));
}
