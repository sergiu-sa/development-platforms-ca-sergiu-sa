import { describe, it, expect } from "vitest";
import { readingTimeMinutes } from "./reading-time";

describe("readingTimeMinutes", () => {
  it("divides by 230 words per minute", () => {
    expect(readingTimeMinutes(460, "news")).toBe(2);
    expect(readingTimeMinutes(2300, "features")).toBe(10);
  });

  it("rounds to the nearest minute", () => {
    // 2.17 and 2.6 - one rounds down, one rounds up.
    expect(readingTimeMinutes(500, "news")).toBe(2);
    expect(readingTimeMinutes(600, "news")).toBe(3);
  });

  it("never returns zero for a story that has words", () => {
    // 90 words rounds to 0 minutes, and "0 min read" reads as a bug.
    expect(readingTimeMinutes(90, "news")).toBe(1);
    expect(readingTimeMinutes(1, "news")).toBe(1);
  });

  it("is null for a live blog whatever its word count", () => {
    // The count is only what has been posted so far, so any figure is a lie
    // that grows all afternoon.
    expect(readingTimeMinutes(2344, "minutebyminute")).toBeNull();
    expect(readingTimeMinutes(50, "minutebyminute")).toBeNull();
  });

  it("is null when the word count is missing or unusable", () => {
    expect(readingTimeMinutes(null, "news")).toBeNull();
    expect(readingTimeMinutes(undefined, "news")).toBeNull();
    expect(readingTimeMinutes(0, "news")).toBeNull();
    expect(readingTimeMinutes(-100, "news")).toBeNull();
  });

  it("treats an unrecognised tone as an ordinary story", () => {
    expect(readingTimeMinutes(460, "somethingnew")).toBe(2);
  });
});
