import { describe, expect, it } from "vitest";
import { nextScriptForMode } from "./next-script";

describe("nextScriptForMode", () => {
  it("runs the production server in prod mode", () => {
    expect(nextScriptForMode("prod")).toBe("chatbot:start");
  });

  it("runs the dev server in dev mode", () => {
    expect(nextScriptForMode("dev")).toBe("chatbot:dev");
  });

  it("defaults to the dev server when the mode is unset", () => {
    expect(nextScriptForMode(undefined)).toBe("chatbot:dev");
  });

  it("defaults to the dev server for an unrecognised mode", () => {
    expect(nextScriptForMode("production")).toBe("chatbot:dev");
  });
});
