import { describe, expect, it } from "vitest";
import { renderErrorPage } from "./error-page";

describe("renderErrorPage", () => {
  it("includes the failed URL and reason in the rendered HTML", () => {
    const html = renderErrorPage("https://example.com/missing", "ERR_NAME_NOT_RESOLVED");
    expect(html).toContain("https://example.com/missing");
    expect(html).toContain("ERR_NAME_NOT_RESOLVED");
  });

  it("escapes HTML in the failed URL to prevent injection", () => {
    const html = renderErrorPage("https://x.test/?<script>alert(1)</script>", "boom");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("escapes HTML in the reason", () => {
    const html = renderErrorPage("https://x.test", '"><img onerror=x>');
    expect(html).not.toContain('"><img onerror=x>');
    expect(html).toContain("&quot;&gt;&lt;img onerror=x&gt;");
  });
});
