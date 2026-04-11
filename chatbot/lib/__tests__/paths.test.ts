import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENTS_ROOT, CHATBOT_ROOT, PORTS_FILE, TSX_BIN } from "../paths";

describe("paths", () => {
  it("CHATBOT_ROOT points to the chatbot/ directory", () => {
    expect(basename(CHATBOT_ROOT)).toBe("chatbot");
    expect(existsSync(CHATBOT_ROOT)).toBe(true);
  });

  it("AGENTS_ROOT is one level above CHATBOT_ROOT", () => {
    expect(AGENTS_ROOT).toBe(resolve(CHATBOT_ROOT, ".."));
    expect(existsSync(AGENTS_ROOT)).toBe(true);
  });

  it.skipIf(!existsSync(resolve(AGENTS_ROOT, "agents")))(
    "AGENTS_ROOT contains the agents/ directory (requires ~/.dovepaw/plugins setup)",
    () => {
      expect(existsSync(resolve(AGENTS_ROOT, "agents"))).toBe(true);
    },
  );

  it("TSX_BIN points inside chatbot node_modules", () => {
    expect(TSX_BIN).toContain("tsx");
  });

  it("PORTS_FILE is inside ~/.dovepaw/ and follows .ports.<port>.json naming", () => {
    expect(PORTS_FILE).toContain(".dovepaw");
    expect(basename(PORTS_FILE)).toMatch(/^\.ports\.\d+\.json$/);
  });
});
