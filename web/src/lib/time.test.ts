import { describe, it, expect } from "vitest";
import { relativeTime } from "./time";

const now = new Date("2026-07-29T14:05:00.000Z");

describe("relativeTime", () => {
  it("reads 'just now' under a minute", () => {
    expect(relativeTime("2026-07-29T14:04:30.000Z", now)).toBe("just now");
  });

  it("reads minutes under an hour", () => {
    expect(relativeTime("2026-07-29T13:31:00.000Z", now)).toBe("34m ago");
  });

  it("reads hours under a day", () => {
    expect(relativeTime("2026-07-29T09:05:00.000Z", now)).toBe("5h ago");
  });

  it("falls back to a date beyond a day", () => {
    expect(relativeTime("2026-07-20T09:05:00.000Z", now)).toBe("20 Jul");
  });
});
