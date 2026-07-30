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

function extractOpacityFloor(): number {
  const match = css.match(/--opacity-floor:\s*([\d.]+)\s*;/);
  if (!match) {
    throw new Error(
      "app.css is missing the --opacity-floor custom property - the " +
        "contrast test cannot verify a floor that no longer exists."
    );
  }
  return Number(match[1]);
}

/**
 * Every literal `opacity: <number>` in the stylesheet, with the selector it
 * belongs to.
 *
 * This exists because the two named-token tests below did NOT catch a real
 * defect: .wire-tick shipped at opacity 0.55, which composites to 3.92:1 and
 * fails AA. Checking two tokens proves nothing about the other declarations.
 *
 * Values written as var(--opacity) or var(--opacity-floor) are skipped: the
 * first is the ramp's own output, already covered by ramp.test.ts, and the
 * second is the floor itself.
 */
function literalOpacityDeclarations(): { selector: string; value: number }[] {
  const found: { selector: string; value: number }[] = [];
  const pattern = /opacity:\s*([\d.]+)\s*;/g;

  for (const match of css.matchAll(pattern)) {
    const before = css.slice(0, match.index);
    const braceAt = before.lastIndexOf("{");
    const selector = before
      .slice(before.lastIndexOf("}", braceAt) + 1, braceAt)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim()
      .replace(/\s+/g, " ");
    found.push({ selector, value: Number(match[1]) });
  }

  return found;
}

describe("contrast floor", () => {
  const paper = hexToRgb(paperHex);
  const ink = hexToRgb(inkHex);
  const signal = hexToRgb(signalHex);

  // The stylesheet and the ramp each carry the floor. If they drift, one of
  // them is silently wrong and nothing else would notice.
  it("keeps --opacity-floor in app.css equal to OPACITY_MIN in ramp.ts", () => {
    expect(extractOpacityFloor()).toBe(OPACITY_MIN);
  });

  it("never lets a literal opacity in app.css fall below the floor", () => {
    const offenders = literalOpacityDeclarations()
      .filter((d) => d.value < OPACITY_MIN)
      .map((d) => `${d.selector} { opacity: ${d.value} }`);

    expect(
      offenders,
      `These rules set a text opacity below the ${OPACITY_MIN} accessibility ` +
        "floor. Use var(--opacity-floor), or raise the value:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });

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
