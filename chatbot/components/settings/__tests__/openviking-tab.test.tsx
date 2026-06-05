import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OpenVikingTab } from "../openviking-tab";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", (input: string) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.endsWith("/api/openviking/config")) {
      return Promise.resolve(json({ config: null, source: "empty" }));
    }
    if (url.endsWith("/api/openviking/version")) {
      return Promise.resolve(json({ current: "0.3.16", latest: "0.3.23" }));
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpenVikingTab", () => {
  it("shows the current and latest OpenViking version with an update hint", async () => {
    render(<OpenVikingTab />);
    const line = await screen.findByText(
      (_content, el) =>
        el?.tagName === "P" &&
        /Version 0\.3\.16 · latest 0\.3\.23 \(update available\)/.test(el.textContent ?? ""),
    );
    expect(line).toBeTruthy();
  });
});
