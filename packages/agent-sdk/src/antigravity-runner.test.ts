import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AntigravityRunner,
  DEFAULT_ANTIGRAVITY_MODEL,
  buildAgyArgs,
  resolveAgyBin,
} from "./antigravity-runner.js";

const TMP_DIR = join(tmpdir(), `antigravity-runner-test-${process.pid}`);

function makeStubAgy(filePath: string, jsBody: string): string {
  writeFileSync(filePath, `#!/usr/bin/env node\n${jsBody}\n`);
  chmodSync(filePath, 0o755);
  return filePath;
}

describe("resolveAgyBin", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("uses explicit executable override when provided", () => {
    const bin = makeStubAgy(join(TMP_DIR, "custom-agy"), "");
    expect(resolveAgyBin(bin, {})).toBe(bin);
  });

  it("throws when explicit path does not exist or is not executable", () => {
    const missing = join(TMP_DIR, "does-not-exist");
    expect(() => resolveAgyBin(missing, {})).toThrow(/not found or not executable/);

    const nonExec = join(TMP_DIR, "not-exec-agy");
    writeFileSync(nonExec, "#!/bin/sh\n");
    chmodSync(nonExec, 0o644);
    expect(() => resolveAgyBin(nonExec, {})).toThrow(/not found or not executable/);
  });

  it("uses DOVEPAW_AGY_BIN env var when set", () => {
    const bin = makeStubAgy(join(TMP_DIR, "env-agy"), "");
    expect(resolveAgyBin(undefined, { DOVEPAW_AGY_BIN: bin })).toBe(bin);
  });

  it("finds agy on PATH", () => {
    const binDir = join(TMP_DIR, "path-bin");
    mkdirSync(binDir, { recursive: true });
    const bin = makeStubAgy(join(binDir, "agy"), "");
    expect(resolveAgyBin(undefined, { PATH: binDir, HOME: join(TMP_DIR, "empty-home") })).toBe(bin);
  });

  it("falls back to ~/.local/bin/agy when PATH omits it", () => {
    const fakeHome = join(TMP_DIR, "home");
    const localBinDir = join(fakeHome, ".local", "bin");
    mkdirSync(localBinDir, { recursive: true });
    const bin = makeStubAgy(join(localBinDir, "agy"), "");
    expect(resolveAgyBin(undefined, { PATH: "", HOME: fakeHome })).toBe(bin);
  });

  it("throws a clear error when agy is not installed anywhere", () => {
    expect(() =>
      resolveAgyBin(undefined, { PATH: "", HOME: join(TMP_DIR, "no-agy-home") }),
    ).toThrow(/Antigravity CLI \(`agy`\) is not installed/);
  });
});

describe("buildAgyArgs", () => {
  it("uses DEFAULT_ANTIGRAVITY_MODEL (gemini-4-neon) and autonomous flags by default", () => {
    const args = buildAgyArgs("hello world", { cwd: TMP_DIR, taskName: "t" });
    expect(args).toEqual([
      "--output-format",
      "stream-json",
      "--model",
      DEFAULT_ANTIGRAVITY_MODEL,
      "--dangerously-skip-permissions",
      "--print=hello world",
    ]);
  });

  it("maps read-only to plan + sandbox and supervised to skip-permissions + sandbox", () => {
    const readOnly = buildAgyArgs("check", {
      cwd: TMP_DIR,
      taskName: "t",
      securityMode: "read-only",
    });
    expect(readOnly).toContain("--mode");
    expect(readOnly[readOnly.indexOf("--mode") + 1]).toBe("plan");
    expect(readOnly).toContain("--sandbox");
    expect(readOnly).not.toContain("--dangerously-skip-permissions");

    const supervised = buildAgyArgs("edit", {
      cwd: TMP_DIR,
      taskName: "t",
      securityMode: "supervised",
    });
    expect(supervised).not.toContain("--mode");
    expect(supervised).toContain("--dangerously-skip-permissions");
    expect(supervised).toContain("--sandbox");
  });

  it("includes effort, sandbox, conversation/continue, add-dir, print-timeout, and system instructions", () => {
    const args = buildAgyArgs("ship it", {
      cwd: TMP_DIR,
      taskName: "t",
      model: "gemini-4-carbon",
      effort: "high",
      enableSandbox: true,
      resumeSession: "conv-prev",
      additionalDirectories: ["/extra/one", "/extra/two"],
      timeoutMs: 45_000,
      appendSystemPrompt: "Be concise.",
    });

    expect(args).toEqual([
      "--output-format",
      "stream-json",
      "--model",
      "gemini-4-carbon",
      "--effort",
      "high",
      "--dangerously-skip-permissions",
      "--sandbox",
      "--conversation",
      "conv-prev",
      "--add-dir",
      "/extra/one",
      "--add-dir",
      "/extra/two",
      "--print-timeout",
      "45s",
      "--print=<system-instructions>\nBe concise.\n</system-instructions>\n\nship it",
    ]);

    const contArgs = buildAgyArgs("next", {
      cwd: TMP_DIR,
      taskName: "t",
      continueSession: true,
    });
    expect(contArgs).toContain("--continue");
  });
});

describe("AntigravityRunner", () => {
  beforeEach(() => {
    mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it("throws immediately when agy is not installed", async () => {
    const prevPath = process.env.PATH;
    const prevHome = process.env.HOME;
    const prevBin = process.env.DOVEPAW_AGY_BIN;
    process.env.PATH = "";
    process.env.HOME = join(TMP_DIR, "no-agy-home");
    delete process.env.DOVEPAW_AGY_BIN;
    try {
      const runner = new AntigravityRunner(TMP_DIR);
      await expect(runner.run("hello", { cwd: TMP_DIR, taskName: "missing-agy" })).rejects.toThrow(
        /Antigravity CLI \(`agy`\) is not installed/,
      );
    } finally {
      if (prevPath === undefined) delete process.env.PATH;
      else process.env.PATH = prevPath;
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevBin === undefined) delete process.env.DOVEPAW_AGY_BIN;
      else process.env.DOVEPAW_AGY_BIN = prevBin;
    }
  });

  it("spawns agy CLI, parses stream-json events, and writes NDJSON log", async () => {
    const stubAgy = makeStubAgy(
      join(TMP_DIR, "stub-agy"),
      [
        "const args = process.argv.slice(2);",
        'console.log(JSON.stringify({ event: "init", conversation_id: "conv-123", init: { model: "gemini-4-neon" } }));',
        'console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: "conv-123", text_delta: "partial" } }));',
        'console.log(JSON.stringify({ event: "result", result: { conversation_id: "conv-123", status: "SUCCESS", response: JSON.stringify(args) } }));',
      ].join("\n"),
    );

    const logFile = join(TMP_DIR, "run.jsonl");
    const runner = new AntigravityRunner(TMP_DIR, logFile);

    const res = await runner.run("ship it", {
      cwd: TMP_DIR,
      taskName: "agy-ok",
      model: "gemini-4-carbon",
      additionalDirectories: ["/extra/dir"],
      appendSystemPrompt: "Be concise.",
      resumeSession: "conv-prev",
      securityMode: "read-only",
      agyBin: stubAgy,
    });

    expect(res.code).toBe(0);
    expect(res.sessionId).toBe("conv-123");
    const passedArgs = JSON.parse(res.stdout) as string[];
    expect(passedArgs).toEqual([
      "--output-format",
      "stream-json",
      "--model",
      "gemini-4-carbon",
      "--mode",
      "plan",
      "--sandbox",
      "--conversation",
      "conv-prev",
      "--add-dir",
      "/extra/dir",
      "--print=<system-instructions>\nBe concise.\n</system-instructions>\n\nship it",
    ]);
    const logLines = readFileSync(logFile, "utf-8").trim().split("\n");
    expect(logLines).toHaveLength(3);
  });

  it("falls back to accumulated step_update text_delta when result has no response field", async () => {
    const stubAgy = makeStubAgy(
      join(TMP_DIR, "delta-agy"),
      [
        'console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: "conv-2", text_delta: "Hello " } }));',
        'console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: "conv-2", text_delta: "world" } }));',
        'console.log(JSON.stringify({ event: "result", result: { conversation_id: "conv-2", status: "SUCCESS" } }));',
      ].join("\n"),
    );

    const runner = new AntigravityRunner(TMP_DIR);
    const res = await runner.run("hi", { cwd: TMP_DIR, taskName: "delta", agyBin: stubAgy });
    expect(res).toEqual({ code: 0, stdout: "Hello world", sessionId: "conv-2" });
  });

  it("returns error code and message when agy emits an error event or non-SUCCESS result", async () => {
    const stubErr = makeStubAgy(
      join(TMP_DIR, "err-agy"),
      [
        'console.log(JSON.stringify({ event: "error", message: "Not signed in to Antigravity" }));',
        "process.exit(1);",
      ].join("\n"),
    );

    const runner = new AntigravityRunner(TMP_DIR);
    const resErr = await runner.run("hello", {
      cwd: TMP_DIR,
      taskName: "agy-err",
      agyBin: stubErr,
    });
    expect(resErr).toEqual({ code: 1, stdout: "Error: Not signed in to Antigravity" });

    const stubFailedResult = makeStubAgy(
      join(TMP_DIR, "fail-result-agy"),
      'console.log(JSON.stringify({ event: "result", result: { status: "FAILED", error: "Quota exceeded" } }));',
    );
    const resFail = await runner.run("hello", {
      cwd: TMP_DIR,
      taskName: "agy-fail",
      agyBin: stubFailedResult,
    });
    expect(resFail).toEqual({ code: 1, stdout: "Error: Quota exceeded" });
  });

  it("kills the subprocess and reports timeout when execution exceeds timeoutMs", async () => {
    const slowAgy = makeStubAgy(join(TMP_DIR, "slow-agy"), "setTimeout(() => {}, 30000);");

    const runner = new AntigravityRunner(TMP_DIR);
    const res = await runner.run("hello", {
      cwd: TMP_DIR,
      taskName: "agy-timeout",
      timeoutMs: 150,
      agyBin: slowAgy,
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
