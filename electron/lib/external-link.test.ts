import { describe, expect, it } from "vitest";
import { isExternalLink, leavesApp } from "./external-link";

const APP_URL = "http://localhost:7473";

describe("isExternalLink", () => {
  it.each([
    "https://github.com/PixelPaw-Labs/DovePaw",
    "http://example.com/page",
    "mailto:a@example.com",
  ])("accepts %s", (url) => {
    expect(isExternalLink(url)).toBe(true);
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "about:blank", "not a url", ""])(
    "rejects %s",
    (url) => {
      expect(isExternalLink(url)).toBe(false);
    },
  );
});

describe("leavesApp", () => {
  it("treats a page on the app's own origin as staying in the app", () => {
    expect(leavesApp("http://localhost:7473/settings?tab=agents", APP_URL)).toBe(false);
  });

  it("treats another site as leaving the app", () => {
    expect(leavesApp("https://github.com/PixelPaw-Labs/DovePaw", APP_URL)).toBe(true);
  });

  it("treats another localhost port as leaving the app", () => {
    expect(leavesApp("http://localhost:1933/console", APP_URL)).toBe(true);
  });

  it("does not treat an unparseable URL as leaving the app", () => {
    expect(leavesApp("not a url", APP_URL)).toBe(false);
  });
});
