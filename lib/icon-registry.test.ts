import { describe, expect, it } from "vitest";
import { Bot, Brain, Zap } from "lucide-react";
import {
  resolveIcon,
  LUCIDE_ICON_REGISTRY,
  ICON_NAMES,
  ICON_COLOR_PRESETS,
  DEFAULT_ICON_STYLE,
} from "./icon-registry.js";

describe("resolveIcon", () => {
  it("returns the matching LucideIcon for a known name", () => {
    expect(resolveIcon("Brain")).toBe(Brain);
    expect(resolveIcon("Zap")).toBe(Zap);
  });

  it("falls back to Bot for an unknown name", () => {
    expect(resolveIcon("NonExistentIcon")).toBe(Bot);
  });

  it("falls back to Bot when name is undefined", () => {
    expect(resolveIcon(undefined)).toBe(Bot);
  });
});

describe("LUCIDE_ICON_REGISTRY", () => {
  it("contains Bot as a fallback entry", () => {
    expect(LUCIDE_ICON_REGISTRY["Bot"]).toBe(Bot);
  });

  it("keys match ICON_NAMES sorted list", () => {
    expect(ICON_NAMES).toEqual(Object.keys(LUCIDE_ICON_REGISTRY).toSorted());
  });
});

describe("ICON_COLOR_PRESETS", () => {
  it("has at least one preset", () => {
    expect(ICON_COLOR_PRESETS.length).toBeGreaterThan(0);
  });

  it("each preset has all required fields", () => {
    for (const preset of ICON_COLOR_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.iconBg).toMatch(/bg-/);
      expect(preset.iconColor).toMatch(/text-/);
      expect(preset.swatch).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(preset.previewBg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(preset.previewIconColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("DEFAULT_ICON_STYLE matches the first preset", () => {
    expect(DEFAULT_ICON_STYLE.iconBg).toBe(ICON_COLOR_PRESETS[0].iconBg);
    expect(DEFAULT_ICON_STYLE.iconColor).toBe(ICON_COLOR_PRESETS[0].iconColor);
  });
});
