import { describe, expect, it } from "vitest";
import { clampIndex, hashForIndex, indexFromHash } from "./state";

describe("clampIndex", () => {
  it("stops at both ends rather than wrapping", () => {
    expect(clampIndex(-1, 6)).toBe(0);
    expect(clampIndex(6, 6)).toBe(5);
    expect(clampIndex(3, 6)).toBe(3);
  });

  it("survives a briefing with nothing in it", () => {
    expect(clampIndex(0, 0)).toBe(0);
    expect(clampIndex(4, 0)).toBe(0);
  });
});

describe("indexFromHash", () => {
  it("reads a padded position as a zero-based index", () => {
    expect(indexFromHash("#01", 6)).toBe(0);
    expect(indexFromHash("#03", 6)).toBe(2);
    expect(indexFromHash("#06", 6)).toBe(5);
  });

  it("accepts an unpadded position, since people type them", () => {
    expect(indexFromHash("#3", 6)).toBe(2);
  });

  it("opens at the lede when there is no hash", () => {
    expect(indexFromHash("", 6)).toBe(0);
    expect(indexFromHash("#", 6)).toBe(0);
  });

  it("opens at the lede rather than the end when the link is stale", () => {
    // A shared link to story 9 of a briefing that now holds 6 should land at the top.
    // Clamping to the last story would silently show something else and look deliberate.
    expect(indexFromHash("#09", 6)).toBe(0);
    expect(indexFromHash("#99", 6)).toBe(0);
  });

  it("refuses anything that is not a plain position", () => {
    expect(indexFromHash("#nonsense", 6)).toBe(0);
    expect(indexFromHash("#00", 6)).toBe(0);
    expect(indexFromHash("#-1", 6)).toBe(0);
    expect(indexFromHash("#1.5", 6)).toBe(0);
    expect(indexFromHash("#01abc", 6)).toBe(0);
  });
});

describe("hashForIndex", () => {
  it("pads to two digits, so the address reads like a running order", () => {
    expect(hashForIndex(0)).toBe("#01");
    expect(hashForIndex(11)).toBe("#12");
  });

  it("round-trips with indexFromHash", () => {
    for (const i of [0, 1, 5]) {
      expect(indexFromHash(hashForIndex(i), 6)).toBe(i);
    }
  });
});
