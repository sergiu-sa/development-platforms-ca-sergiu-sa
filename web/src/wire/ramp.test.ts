import { describe, it, expect } from "vitest";
import { rampFor, freshness, OPACITY_MIN } from "./ramp";

describe("rampFor", () => {
  it("puts the newest story at the top of every axis", () => {
    const r = rampFor(0, 63);
    expect(r.size).toBeCloseTo(74, 5);
    expect(r.wdth).toBeCloseTo(125, 5);
    expect(r.wght).toBeCloseTo(800, 5);
    expect(r.opacity).toBeCloseTo(1, 5);
  });

  it("puts the oldest story at the bottom of every axis", () => {
    const r = rampFor(62, 63);
    expect(r.size).toBeCloseTo(11, 5);
    expect(r.wdth).toBeCloseTo(62, 5);
    expect(r.wght).toBeCloseTo(300, 5);
    expect(r.opacity).toBeCloseTo(OPACITY_MIN, 5);
  });

  it("decreases monotonically on every axis", () => {
    const ramps = Array.from({ length: 63 }, (_, i) => rampFor(i, 63));
    for (let i = 1; i < ramps.length; i++) {
      expect(ramps[i].size).toBeLessThan(ramps[i - 1].size);
      expect(ramps[i].wdth).toBeLessThan(ramps[i - 1].wdth);
      expect(ramps[i].wght).toBeLessThan(ramps[i - 1].wght);
      expect(ramps[i].opacity).toBeLessThan(ramps[i - 1].opacity);
    }
  });

  // The accessibility floor. Text contrast depends on this and nothing else
  // may lower it - see the contrast rule in the spec.
  it("never drops opacity below the contrast floor", () => {
    for (const total of [1, 2, 20, 63, 500]) {
      for (let i = 0; i < total; i++) {
        expect(rampFor(i, total).opacity).toBeGreaterThanOrEqual(OPACITY_MIN);
      }
    }
  });

  it("never renders text below 11px", () => {
    for (let i = 0; i < 500; i++) {
      expect(rampFor(i, 500).size).toBeGreaterThanOrEqual(11);
    }
  });

  it("survives a single-story wire without dividing by zero", () => {
    const r = rampFor(0, 1);
    expect(Number.isFinite(r.size)).toBe(true);
    expect(r.size).toBeCloseTo(74, 5);
  });

  it("clamps a rank beyond the list instead of extrapolating", () => {
    expect(rampFor(99, 20)).toEqual(rampFor(19, 20));
  });
});

describe("freshness", () => {
  const now = Date.parse("2026-07-29T14:05:00.000Z");

  it("is fully fresh when the newest story just landed", () => {
    expect(freshness(now - 60_000, now)).toBeCloseTo(1, 2);
  });

  it("bottoms out after twelve hours", () => {
    expect(freshness(now - 13 * 3_600_000, now)).toBe(0);
  });

  it("never goes negative if a clock is skewed forward", () => {
    expect(freshness(now + 60_000, now)).toBe(1);
  });
});
