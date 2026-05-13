import { beforeAll, describe, it, expect } from "vitest";

// jsdom 29 does not implement CSS.escape; inline the spec-compliant polyfill
// (https://drafts.csswg.org/cssom/#serialize-an-identifier) so the production
// selector logic exercises the same behaviour it would in a real browser.
function cssEscapePolyfill(value: string): string {
  const string = value;
  const length = string.length;
  let index = -1;
  let result = "";
  const firstCodeUnit = string.charCodeAt(0);
  if (length === 1 && firstCodeUnit === 0x002d) return "\\" + string;
  while (++index < length) {
    const codeUnit = string.charCodeAt(index);
    if (codeUnit === 0x0000) {
      result += "�";
      continue;
    }
    if (
      (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
      codeUnit === 0x007f ||
      (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
    ) {
      result += "\\" + codeUnit.toString(16) + " ";
      continue;
    }
    if (
      codeUnit >= 0x0080 ||
      codeUnit === 0x002d ||
      codeUnit === 0x005f ||
      (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
      (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
      (codeUnit >= 0x0061 && codeUnit <= 0x007a)
    ) {
      result += string.charAt(index);
      continue;
    }
    result += "\\" + string.charAt(index);
  }
  return result;
}

beforeAll(() => {
  const g = globalThis as { CSS?: { escape: (s: string) => string } };
  if (!g.CSS) g.CSS = { escape: cssEscapePolyfill };
  else if (!g.CSS.escape) g.CSS.escape = cssEscapePolyfill;
});

// Regression: step IDs are free-form text and may contain quotes, commas,
// brackets, and newlines (e.g. an agent prompt embedded in the ID). The
// overlay looks elements up via container.querySelector(`[data-step-id="..."]`)
// and must escape the ID so the selector stays valid.
describe("HandoffOverlay step-id selector escaping", () => {
  function findByStepId(container: HTMLElement, stepId: string) {
    return container.querySelector<HTMLElement>(`[data-step-id="${CSS.escape(stepId)}"]`);
  }

  const HOSTILE_IDS = [
    'sender-org-"hello"',
    "sender-org-[bracket]",
    "sender-org-foo,bar",
    "sender-org-multi\nline",
    "sender-org-Investigating production: 1. Read logs 2. Check metrics",
  ];

  it.each(HOSTILE_IDS)("finds element with hostile step id: %s", (id) => {
    const container = document.createElement("div");
    const el = document.createElement("span");
    el.setAttribute("data-step-id", id);
    container.appendChild(el);
    document.body.appendChild(container);
    try {
      expect(() => findByStepId(container, id)).not.toThrow();
      expect(findByStepId(container, id)).toBe(el);
    } finally {
      document.body.removeChild(container);
    }
  });

  it("unescaped selectors throw on these IDs (proves the fix is needed)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    try {
      expect(() => container.querySelector(`[data-step-id="${HOSTILE_IDS[0]}"]`)).toThrow();
    } finally {
      document.body.removeChild(container);
    }
  });
});
