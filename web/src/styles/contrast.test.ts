import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { OPACITY_MIN } from "../wire/ramp";

// The accessibility floor used to be enforced only by a comment next to
// OPACITY_MIN in ramp.ts. This test makes it self-enforcing: a renamed
// token or a moved value breaks a test rather than silently drifting.
const cssPath = fileURLToPath(new URL("./app.css", import.meta.url));
const css = readFileSync(cssPath, "utf-8");

function extractColor(name: string): string {
  const pattern = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`);
  const match = css.match(pattern);
  if (!match) {
    throw new Error(
      `app.css is missing the --color-${name} custom property - the ` +
        "contrast test cannot verify a token that no longer exists."
    );
  }
  return match[1];
}

const paperHex = extractColor("paper");
const inkHex = extractColor("ink");
const signalHex = extractColor("signal");

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

// WCAG 2.1 relative luminance formula, applied verbatim.
function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (raw: number): number => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// What the browser actually paints when opacity < 1: the foreground colour
// alpha-blended over the background, channel by channel, measured before
// the unblended foreground colour is ever considered.
function compositeOver(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return {
    r: alpha * fg.r + (1 - alpha) * bg.r,
    g: alpha * fg.g + (1 - alpha) * bg.g,
    b: alpha * fg.b + (1 - alpha) * bg.b,
  };
}

describe("contrast floor", () => {
  const paper = hexToRgb(paperHex);
  const ink = hexToRgb(inkHex);
  const signal = hexToRgb(signalHex);

  it("keeps the faintest ink (OPACITY_MIN over paper) at AA contrast", () => {
    const faded = compositeOver(ink, paper, OPACITY_MIN);
    const ratio = contrastRatio(faded, paper);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the signal colour at AA contrast against paper", () => {
    const ratio = contrastRatio(signal, paper);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
