import { describe, expect, it } from "vitest";
import { formatScheduleDisplay } from "./agents-config-schemas.js";

describe("formatScheduleDisplay", () => {
  it("returns 'on demand' when no schedule", () => {
    expect(formatScheduleDisplay(undefined)).toBe("on demand");
  });

  describe("interval", () => {
    it("formats whole hours", () => {
      expect(formatScheduleDisplay({ type: "interval", seconds: 3600 })).toBe("every 1h");
      expect(formatScheduleDisplay({ type: "interval", seconds: 7200 })).toBe("every 2h");
    });

    it("formats whole minutes", () => {
      expect(formatScheduleDisplay({ type: "interval", seconds: 300 })).toBe("every 5m");
      expect(formatScheduleDisplay({ type: "interval", seconds: 60 })).toBe("every 1m");
    });

    it("formats raw seconds when not a whole minute", () => {
      expect(formatScheduleDisplay({ type: "interval", seconds: 90 })).toBe("every 90s");
      expect(formatScheduleDisplay({ type: "interval", seconds: 1 })).toBe("every 1s");
    });
  });

  describe("calendar — daily", () => {
    it("formats midnight", () => {
      expect(formatScheduleDisplay({ type: "calendar", hour: 0, minute: 0 })).toBe("Daily 00:00");
    });

    it("pads hour and minute", () => {
      expect(formatScheduleDisplay({ type: "calendar", hour: 9, minute: 5 })).toBe("Daily 09:05");
    });

    it("formats afternoon time", () => {
      expect(formatScheduleDisplay({ type: "calendar", hour: 14, minute: 30 })).toBe("Daily 14:30");
    });
  });

  describe("calendar — weekday (ISO 1=Mon…7=Sun)", () => {
    it("formats Monday (1)", () => {
      expect(formatScheduleDisplay({ type: "calendar", hour: 9, minute: 0, weekday: 1 })).toBe(
        "Mon 09:00",
      );
    });

    it("formats Friday (5)", () => {
      expect(formatScheduleDisplay({ type: "calendar", hour: 17, minute: 0, weekday: 5 })).toBe(
        "Fri 17:00",
      );
    });

    it("formats Saturday (6)", () => {
      expect(formatScheduleDisplay({ type: "calendar", hour: 10, minute: 0, weekday: 6 })).toBe(
        "Sat 10:00",
      );
    });

    it("formats Sunday (7)", () => {
      expect(formatScheduleDisplay({ type: "calendar", hour: 12, minute: 0, weekday: 7 })).toBe(
        "Sun 12:00",
      );
    });
  });
});
