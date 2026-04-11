import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  commitFiles,
  createFeatureBranch,
  ensureBaseBranch,
  WORKSPACE_BASE_BRANCH,
} from "./git.js";

const TMP_BASE = join(tmpdir(), `git-test-${process.pid}`);

function makeRepo(suffix: string): string {
  const p = join(TMP_BASE, suffix);
  mkdirSync(p, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: p });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: p });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: p });
  writeFileSync(join(p, "README.md"), "init");
  execFileSync("git", ["add", "README.md"], { cwd: p });
  execFileSync("git", ["commit", "-m", "init"], { cwd: p });
  return p;
}

function currentBranch(repoPath: string): string {
  return execFileSync("git", ["branch", "--show-current"], { cwd: repoPath }).toString().trim();
}

function commitLog(repoPath: string): string[] {
  return execFileSync("git", ["log", "--oneline", "--format=%s"], { cwd: repoPath })
    .toString()
    .trim()
    .split("\n");
}

describe("commitFiles", () => {
  it("commits specified files when they have changes", async () => {
    const repo = makeRepo("commit-1");
    try {
      writeFileSync(join(repo, ".gitignore"), ".gsd/\n");
      await commitFiles(repo, [".gitignore"], "chore: add gitignore");
      expect(commitLog(repo)[0]).toBe("chore: add gitignore");
    } finally {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it("does nothing when there are no changes to commit", async () => {
    const repo = makeRepo("commit-2");
    try {
      writeFileSync(join(repo, ".gitignore"), "");
      execFileSync("git", ["add", ".gitignore"], { cwd: repo });
      execFileSync("git", ["commit", "-m", "pre"], { cwd: repo });
      await commitFiles(repo, [".gitignore"], "should not commit");
      expect(commitLog(repo)[0]).toBe("pre");
    } finally {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });
});

describe("createFeatureBranch", () => {
  it("creates branch from main, commits files, stays on branch", async () => {
    const repo = makeRepo("feature-1");
    try {
      writeFileSync(join(repo, ".gitignore"), ".gsd/\n");
      writeFileSync(join(repo, ".worktreeinclude"), ".claude/agents/\n");
      await createFeatureBranch(
        repo,
        "EC-123",
        [".gitignore", ".worktreeinclude"],
        "chore: add patterns",
      );
      expect(currentBranch(repo)).toBe("EC-123");
      expect(commitLog(repo)[0]).toBe("chore: add patterns");
      expect(readFileSync(join(repo, ".gitignore"), "utf8")).toBe(".gsd/\n");
    } finally {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it("skips commit when files have no changes", async () => {
    const repo = makeRepo("feature-2");
    try {
      writeFileSync(join(repo, ".gitignore"), "");
      execFileSync("git", ["add", ".gitignore"], { cwd: repo });
      execFileSync("git", ["commit", "-m", "pre-add"], { cwd: repo });
      await createFeatureBranch(repo, "EC-124", [".gitignore"], "should not appear");
      expect(currentBranch(repo)).toBe("EC-124");
      expect(commitLog(repo)[0]).toBe("pre-add");
    } finally {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });
});

describe("ensureBaseBranch", () => {
  it("creates branch from main, commits patterns, leaves HEAD on it", async () => {
    const repo = makeRepo("base-1");
    try {
      const patterns = [".gsd/", ".claude/agents/", ".claude/skills/"];
      await ensureBaseBranch(repo, patterns);
      expect(currentBranch(repo)).toBe(WORKSPACE_BASE_BRANCH);
      expect(commitLog(repo)[0]).toBe("chore: configure workspace patterns");
      const gitignore = readFileSync(join(repo, ".gitignore"), "utf8");
      for (const p of patterns) expect(gitignore).toContain(p);
      const worktreeinclude = readFileSync(join(repo, ".worktreeinclude"), "utf8");
      for (const p of patterns) expect(worktreeinclude).toContain(p);
    } finally {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  it("is idempotent — checks out existing branch without committing again", async () => {
    const repo = makeRepo("base-2");
    try {
      const patterns = [".gsd/", ".claude/agents/", ".claude/skills/"];
      await ensureBaseBranch(repo, patterns);
      execFileSync("git", ["checkout", "main"], { cwd: repo });
      await ensureBaseBranch(repo, patterns);
      expect(currentBranch(repo)).toBe(WORKSPACE_BASE_BRANCH);
      const log = commitLog(repo);
      expect(log.filter((l) => l === "chore: configure workspace patterns")).toHaveLength(1);
    } finally {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });
});
