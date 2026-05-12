import { describe, expect, it } from "vitest";
import { groupReposByOwner } from "@/lib/group-repos-by-owner";

const r = (id: string, githubRepo: string) => ({
  id,
  name: githubRepo.split("/").at(-1)!,
  githubRepo,
});

describe("groupReposByOwner", () => {
  it("groups repos by the segment before the slash and sorts owners + repos alphabetically", () => {
    const repos = [
      r("3", "delexw/repo2"),
      r("1", "alice/zzz"),
      r("2", "delexw/repo1"),
      r("4", "alice/aaa"),
    ];
    expect(groupReposByOwner(repos)).toEqual([
      { owner: "alice", repos: [r("4", "alice/aaa"), r("1", "alice/zzz")] },
      { owner: "delexw", repos: [r("2", "delexw/repo1"), r("3", "delexw/repo2")] },
    ]);
  });

  it("handles repos without a slash by placing them under an empty-owner group", () => {
    const repos = [r("1", "lonelyrepo"), r("2", "alice/zzz")];
    const grouped = groupReposByOwner(repos);
    expect(grouped[0].owner).toBe("");
    expect(grouped[1].owner).toBe("alice");
  });

  it("returns an empty array for an empty input", () => {
    expect(groupReposByOwner([])).toEqual([]);
  });
});
