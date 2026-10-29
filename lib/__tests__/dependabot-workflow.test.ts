import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const workflow = readFileSync(resolve(root, ".github/workflows/dependabot-auto-merge.yml"), "utf8");
const dependabot = readFileSync(resolve(root, ".github/dependabot.yml"), "utf8");
const scripts: Record<string, string> = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
).scripts;

describe("dependabot auto-merge workflow", () => {
  it("only runs npm scripts that exist in package.json", () => {
    const used = [...workflow.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(scripts, `npm run ${name}`).toHaveProperty(name);
  });

  it("installs without lifecycle scripts so the root install script never runs in CI", () => {
    expect(scripts.install).toBeDefined();
    expect(workflow).toMatch(/npm ci --ignore-scripts/);
  });

  it("reads the Node version from a file that exists", () => {
    const file = workflow.match(/node-version-file: "([^"]+)"/)?.[1];
    expect(file).toBeDefined();
    expect(existsSync(resolve(root, file!))).toBe(true);
  });

  it("runs every job only for PRs opened by Dependabot", () => {
    const jobs = workflow
      .slice(workflow.indexOf("\njobs:"))
      .split(/^  (?=\w[\w-]*:\s*$)/m)
      .slice(1);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job).toMatch(/if: github\.event\.pull_request\.user\.login == 'dependabot\[bot\]'/);
    }
    expect(workflow).not.toMatch(/github\.actor/);
  });

  it("merges only after the verify job passes", () => {
    expect(workflow).toMatch(/merge:[\s\S]*needs: verify/);
  });
});

describe("dependabot config", () => {
  it("groups version updates and security updates", () => {
    expect(dependabot).toMatch(/applies-to: version-updates/);
    expect(dependabot).toMatch(/applies-to: security-updates/);
  });
});
