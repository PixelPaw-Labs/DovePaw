import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HOOK = resolve(fileURLToPath(import.meta.url), "../quality-gate.js");

const lowScoreInput = (msg = "") =>
  JSON.stringify({
    stop_hook_active: false,
    last_assistant_message: msg || '```json\n{"confidence": 50, "issues": []}\n```',
  });

function runHook(projectDir, input) {
  return spawnSync(process.execPath, [HOOK], {
    input: input ?? lowScoreInput(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    encoding: "utf8",
  });
}

function createAgentLocal(projectDir, agentName, ext) {
  const dir = join(projectDir, "agent-local", agentName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `main${ext}`), "# hello\n");
}

describe("quality-gate — language detection", () => {
  it("uses full TS gate when agent-local has main.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-ts-"));
    try {
      createAgentLocal(dir, "my-agent", ".ts");
      const result = runHook(dir);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("main.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses light gate when agent-local has main.py", () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-py-"));
    try {
      createAgentLocal(dir, "my-agent", ".py");
      const result = runHook(dir);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).not.toContain("main.ts");
      expect(parsed.reason).toContain("agent.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses light gate when agent-local has main.sh", () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-sh-"));
    try {
      createAgentLocal(dir, "my-agent", ".sh");
      const result = runHook(dir);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).not.toContain("main.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to full TS gate when agent-local does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-empty-"));
    try {
      const result = runHook(dir);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.decision).toBe("block");
      expect(parsed.reason).toContain("main.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("quality-gate — pass through", () => {
  it("exits 0 with no output when confidence >= 90", () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-pass-"));
    try {
      const input = JSON.stringify({
        stop_hook_active: false,
        last_assistant_message: '```json\n{"confidence": 95, "issues": []}\n```',
      });
      const result = runHook(dir, input);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 0 when stop_hook_active is true (prevents infinite loop)", () => {
    const dir = mkdtempSync(join(tmpdir(), "qg-active-"));
    try {
      const input = JSON.stringify({
        stop_hook_active: true,
        last_assistant_message: '{"confidence": 50, "issues": []}',
      });
      const result = runHook(dir, input);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
