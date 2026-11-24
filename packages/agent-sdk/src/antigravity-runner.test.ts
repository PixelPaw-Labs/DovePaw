import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AntigravityRunner,
  resolveAntigravityBridgePath,
  resolveAntigravityPython,
} from "./antigravity-runner.js";

const TMP_DIR = join(tmpdir(), `antigravity-runner-test-${process.pid}`);

describe("resolveAntigravityPython", () => {
  it("uses explicit override when provided", () => {
    expect(resolveAntigravityPython("/custom/python", {})).toBe("/custom/python");
  });

  it("uses DOVEPAW_ANTIGRAVITY_PYTHON env var when set", () => {
    expect(
      resolveAntigravityPython(undefined, { DOVEPAW_ANTIGRAVITY_PYTHON: "/env/python3" }),
    ).toBe("/env/python3");
  });

  it("falls back to <DOVEPAW_DATA_DIR>/antigravity-venv/bin/python", () => {
    const resolved = resolveAntigravityPython(undefined, { DOVEPAW_DATA_DIR: "/tmp/dovepaw-test" });
    expect(resolved).toContain("/tmp/dovepaw-test/antigravity-venv/");
    expect(resolved).toMatch(/python(\.exe)?$/);
  });
});

describe("resolveAntigravityBridgePath", () => {
  it("returns explicit override when provided", () => {
    expect(resolveAntigravityBridgePath("/custom/bridge.py")).toBe("/custom/bridge.py");
  });

  it("resolves antigravity-bridge.py beside the runner module", () => {
    expect(resolveAntigravityBridgePath()).toMatch(/antigravity-bridge\.py$/);
  });
});

describe("AntigravityRunner", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("returns an error when the default venv python does not exist", async () => {
    const prev = process.env.DOVEPAW_DATA_DIR;
    process.env.DOVEPAW_DATA_DIR = join(TMP_DIR, "missing-dovepaw");
    try {
      const runner = new AntigravityRunner(TMP_DIR);
      const res = await runner.run("hello", { cwd: TMP_DIR, taskName: "missing-venv" });
      expect(res.code).toBe(1);
      expect(res.stdout).toContain("Antigravity Python SDK venv not found");
    } finally {
      if (prev === undefined) delete process.env.DOVEPAW_DATA_DIR;
      else process.env.DOVEPAW_DATA_DIR = prev;
    }
  });

  it("bridges JSON payload over stdin and parses NDJSON result + writes log", async () => {
    const stubBridge = join(TMP_DIR, "stub-bridge.py");
    writeFileSync(
      stubBridge,
      [
        "import json, sys",
        "payload = json.loads(sys.stdin.read())",
        'print(json.dumps({"type": "init", "conversationId": "conv-1"}), flush=True)',
        'print(json.dumps({"type": "result", "ok": True, "text": json.dumps(payload), "conversationId": "conv-1"}), flush=True)',
      ].join("\n"),
    );
    const logFile = join(TMP_DIR, "run.jsonl");
    const runner = new AntigravityRunner(TMP_DIR, logFile);

    const res = await runner.run("ship it", {
      cwd: TMP_DIR,
      taskName: "bridge-ok",
      model: "gemini-3.8-flash",
      additionalDirectories: ["/extra/dir"],
      appendSystemPrompt: "Be concise.",
      sessionId: "conv-1",
      resumeSession: "conv-prev",
      securityMode: "read-only",
      allowWebTools: true,
      enableSandbox: true,
      skillsPaths: ["~/.gemini/config/skills"],
      pythonBin: "python3",
      bridgeScriptPath: stubBridge,
    });

    expect(res.code).toBe(0);
    expect(res.sessionId).toBe("conv-1");
    const echoed = JSON.parse(res.stdout) as Record<string, unknown>;
    expect(echoed).toMatchObject({
      prompt: "ship it",
      cwd: TMP_DIR,
      model: "gemini-3.8-flash",
      additionalDirectories: ["/extra/dir"],
      appendSystemPrompt: "Be concise.",
      sessionId: "conv-1",
      resumeSession: "conv-prev",
      securityMode: "read-only",
      allowWebTools: true,
      enableSandbox: true,
      skillsPaths: ["~/.gemini/config/skills"],
    });
    expect(String(echoed.saveDir)).toContain(".antigravity-sessions");
    const logLines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(logLines).toHaveLength(2);
  });

  it("returns error code and message when bridge emits an error event", async () => {
    const stubBridge = join(TMP_DIR, "err-bridge.py");
    writeFileSync(
      stubBridge,
      [
        "import json, sys",
        "sys.stdin.read()",
        'print(json.dumps({"type": "error", "message": "Auth failed"}), flush=True)',
        "sys.exit(1)",
      ].join("\n"),
    );

    const runner = new AntigravityRunner(TMP_DIR);
    const res = await runner.run("hello", {
      cwd: TMP_DIR,
      taskName: "bridge-err",
      pythonBin: "python3",
      bridgeScriptPath: stubBridge,
    });

    expect(res.code).toBe(1);
    expect(res.stdout).toBe("Error: Auth failed");
  });

  it("kills the subprocess and reports timeout when execution exceeds timeoutMs", async () => {
    const slowBridge = join(TMP_DIR, "slow-bridge.py");
    writeFileSync(slowBridge, "import sys, time\nsys.stdin.read()\ntime.sleep(30)\n");

    const runner = new AntigravityRunner(TMP_DIR);
    const res = await runner.run("hello", {
      cwd: TMP_DIR,
      taskName: "bridge-timeout",
      timeoutMs: 150,
      pythonBin: "python3",
      bridgeScriptPath: slowBridge,
    });

    expect(res.code).toBe(1);
    expect(res.stdout).toContain("TIMEOUT");
  });

  it("writeLog writes output to logDir", () => {
    const runner = new AntigravityRunner(TMP_DIR);
    const path = runner.writeLog("agy", "123", "hello log");
    expect(path).toBe(join(TMP_DIR, "agy-123.log"));
    expect(readFileSync(path, "utf-8")).toBe("hello log");
  });
});
