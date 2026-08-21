import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The accessibility floor, swept out of the stylesheet rather than trusted to a comment.
 * Three things can breach it and each has its own check below:
 * a token that is simply too pale, an opacity that composites below AA, and a font-size under the readable minimum.
 *
 * This used to also keep --opacity-floor in app.css equal to OPACITY_MIN in wire/ramp.ts.
 * The ramp is deleted, so the floor now lives in exactly one place - this file - and that test guarded nothing worth keeping.
 */
const cssPath = fileURLToPath(new URL("./app.css", import.meta.url));
const css = readFileSync(cssPath, "utf-8");

const webRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Every page's markup, read once, and discovered rather than listed.
 *
 * This was a hand-written array of three filenames, which meant a page added by a later phase escaped both sweeps below until somebody remembered to add it;
 * and the failure is silent, which is the worst kind this file has.
 * The desk was the fourth page and would have been the first to slip through.
 */
const MARKUP_FILES = readdirSync(webRoot)
  .filter((file) => file.endsWith(".html"))
  .sort()
  .map((file) => ({
    file,
    markup: readFileSync(`${webRoot}${file}`, "utf-8"),
  }));

// Discovery replaced a hand-written list, which traded one silent failure for another:
// a list goes stale when a page is added, but a glob that finds nothing sweeps nothing and both markup checks below pass green.
// The hard-coded version at least threw ENOENT. This is the guard on the guard.
if (MARKUP_FILES.length === 0) {
  throw new Error(
    `No HTML pages found in ${webRoot} - the sweep would pass vacuously`
  );
}

/** Ink at this opacity measures 7.37:1 on paper. Below it, AA starts to fail. */
const OPACITY_FLOOR = 0.72;

/** Nothing read as prose goes below this. */
const PROSE_MIN_PX = 15;

/** Nothing at all goes below this. */
const ABSOLUTE_MIN_PX = 12;

/**
 * Selectors allowed to set a size between ABSOLUTE_MIN_PX and PROSE_MIN_PX.
 * Furniture only - labels, slugs, timestamps, buttons, status. Adding to this list is the deliberate act the test exists to force.
 */
const FURNITURE_SELECTORS = [
  ".m",
  // The "!" in the mark beside a form error.
  // A glyph in a bordered box, at the same 12px the rest of the furniture uses, and the sentence it introduces is full-size prose beside it.
  // It is the mark half of "colour is never the only signal", not something anybody reads.
  ".auth-error::before",
];

/**
 * Keyframes allowed to animate opacity below the floor.
 *
 * Named one by one rather than exempting @keyframes wholesale, because fading a block of text to 0.25 and leaving it there is a genuine failure and should still break this test.
 * Every entry here is transient, decorative, and gone entirely under prefers-reduced-motion.
 *
 * - `beat` is the live dot's pulse. A graphic, not text, and redundant with the word "Live" beside it, so dimming it costs a reader nothing.
 * - `fly-skip` and `fly-save` fade out the card that was just decided. It is an inert, aria-hidden clone leaving the frame; the decision itself has already been applied and the next card is already on screen.
 * - `deal` fades the incoming card in over 180ms. Contrast is a property of what a page settles at, and this one settles at full strength.
 */
const EXEMPT_KEYFRAMES = ["beat", "fly-skip", "fly-save", "deal"];

interface Rgb {
  r: number;
  g: number;
  b: number;
}

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

// What the browser actually paints when opacity < 1:
// the foreground colour alpha-blended over the background, channel by channel, measured before the unblended foreground colour is ever considered.
function compositeOver(fg: Rgb, bg: Rgb, alpha: number): Rgb {
  return {
    r: alpha * fg.r + (1 - alpha) * bg.r,
    g: alpha * fg.g + (1 - alpha) * bg.g,
    b: alpha * fg.b + (1 - alpha) * bg.b,
  };
}

/**
 * Every @keyframes block's name and character range, found once.
 * Braces are matched forward from each block's opening, so a nested rule cannot make a later declaration look as though it is still inside the animation.
 */
const KEYFRAME_RANGES = [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map(
  (match) => {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      i++;
    }
    return { name: match[1], start: match.index, end: i };
  }
);

/** The name of the @keyframes block containing `index`, or null. */
function keyframeAt(index: number): string | null {
  const block = KEYFRAME_RANGES.find(
    (range) => index > range.start && index < range.end
  );
  return block ? block.name : null;
}

/** The selector a declaration at `index` belongs to. */
function selectorAt(index: number): string {
  const before = css.slice(0, index);
  const braceAt = before.lastIndexOf("{");
  return before
    .slice(before.lastIndexOf("}", braceAt) + 1, braceAt)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Every literal `opacity: <number>` in the stylesheet, with its selector.
 *
 * This exists because checking named tokens did NOT catch a real defect once:
 * .wire-tick shipped at opacity 0.55, which composites to 3.92:1 and fails AA.
 * Checking a token proves nothing about the other declarations.
 */
function literalOpacityDeclarations(): {
  selector: string;
  value: number;
  keyframe: string | null;
}[] {
  const found: {
    selector: string;
    value: number;
    keyframe: string | null;
  }[] = [];

  for (const match of css.matchAll(/opacity:\s*([\d.]+)\s*;/g)) {
    found.push({
      selector: selectorAt(match.index),
      value: Number(match[1]),
      keyframe: keyframeAt(match.index),
    });
  }

  return found;
}

/** Every `font-size` in the stylesheet, in px, with its selector. */
function fontSizeDeclarations(): { selector: string; px: number }[] {
  const found: { selector: string; px: number }[] = [];

  for (const match of css.matchAll(/font-size:\s*([^;]+);/g)) {
    const raw = match[1].trim();

    // clamp(min, preferred, max) is measured at its minimum: that is the size the smallest viewport actually renders, and the only one that can breach the floor.
    const value = raw.startsWith("clamp(")
      ? raw.slice("clamp(".length).split(",")[0].trim()
      : raw;

    const number = parseFloat(value);
    if (Number.isNaN(number)) continue;

    const px = value.endsWith("rem") ? number * 16 : number;
    found.push({ selector: selectorAt(match.index), px });
  }

  return found;
}

/**
 * Tailwind alpha utilities written directly in markup, e.g. `text-ink/72`.
 *
 * This is the third channel the floor can leak through. A `text-ink/40` in an HTML file never touches app.css, so neither check above would see it.
 *
 * Deliberately measures the composited contrast rather than just asserting the alpha is >= the floor.
 * A pale token at a high alpha can still fail, and it is the ratio the requirement is actually about.
 */
function alphaUtilities(): { file: string; token: string; alpha: number }[] {
  const found: { file: string; token: string; alpha: number }[] = [];

  for (const { file, markup } of MARKUP_FILES) {
    for (const m of markup.matchAll(/\btext-([a-z][\w-]*)\/(\d{1,3})\b/g)) {
      found.push({ file, token: m[1], alpha: Number(m[2]) / 100 });
    }
  }

  return found;
}

const paper = hexToRgb(extractColor("paper"));
const paper2 = hexToRgb(extractColor("paper-2"));
const ink = hexToRgb(extractColor("ink"));
const blue = hexToRgb(extractColor("blue"));
const redInk = hexToRgb(extractColor("red-ink"));

describe("contrast floor", () => {
  // Both grounds are tested because red text lands on the recessed band too;
  // the stale notice and a hovered row - and paper-2 is the harder of the two.
  // It is what decided the value of --color-red-ink.
  const pairs: [string, Rgb, Rgb][] = [
    ["ink on paper", ink, paper],
    ["ink on paper-2", ink, paper2],
    ["blue on paper", blue, paper],
    ["blue on paper-2", blue, paper2],
    ["paper on blue", paper, blue],
    ["red-ink on paper", redInk, paper],
    ["red-ink on paper-2", redInk, paper2],
    ["paper on red-ink", paper, redInk],
  ];

  it.each(pairs)("keeps %s at AA contrast", (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps .quiet ink at AA contrast on both grounds", () => {
    for (const ground of [paper, paper2]) {
      const faded = compositeOver(ink, ground, OPACITY_FLOOR);
      expect(contrastRatio(faded, ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  /**
   * --color-red measures 2.93:1 on paper. It fails AA for text and fails even the 3:1 non-text threshold, so it is only ever a filled mark that stands alone:
   * the tick gauge's "now", a spindle thread.
   * The moment it sets a glyph it is a contrast failure, and --color-red-ink exists for exactly that job.
   *
   * The negative lookahead is load-bearing: --color-red is a prefix of --color-red-ink, so matching var(--color-red without the closing paren would flag every correct use.
   */
  it("never sets a glyph in --color-red", () => {
    const offenders: string[] = [];

    for (const match of css.matchAll(/(?<!-)color:\s*([^;]+);/g)) {
      if (/var\(--color-red\)/.test(match[1])) {
        offenders.push(`${selectorAt(match.index)} { color: ${match[1]} }`);
      }
    }

    expect(
      offenders,
      "--color-red is 2.93:1 on paper and must never set text. Use " +
        "--color-red-ink for a red glyph:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("never lets a literal opacity in app.css fall below the floor", () => {
    const offenders = literalOpacityDeclarations()
      // WCAG 1.4.3 exempts inactive controls from the contrast minimum, so a dimmed :disabled button is allowed below the floor.
      // Every other selector is held to it.
      .filter((d) => !d.selector.includes(":disabled"))
      .filter((d) => !(d.keyframe && EXEMPT_KEYFRAMES.includes(d.keyframe)))
      .filter((d) => d.value < OPACITY_FLOOR)
      .map((d) =>
        d.keyframe
          ? `@keyframes ${d.keyframe} { opacity: ${d.value} }`
          : `${d.selector} { opacity: ${d.value} }`
      );

    expect(
      offenders,
      `These rules set a text opacity below the ${OPACITY_FLOOR} floor. Use ` +
        "the .quiet class, or raise the value:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });
});

describe("type floor", () => {
  it("sets nothing at all below 12px", () => {
    const offenders = fontSizeDeclarations()
      .filter((d) => d.px < ABSOLUTE_MIN_PX)
      .map((d) => `${d.selector} { font-size: ${d.px}px }`);

    expect(
      offenders,
      `Nothing on this site goes below ${ABSOLUTE_MIN_PX}px:\n` +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("sets nothing read as prose below 15px", () => {
    const offenders = fontSizeDeclarations()
      .filter((d) => d.px < PROSE_MIN_PX)
      .filter((d) => !FURNITURE_SELECTORS.includes(d.selector))
      .map((d) => `${d.selector} { font-size: ${d.px}px }`);

    expect(
      offenders,
      `Only furniture may sit between ${ABSOLUTE_MIN_PX} and ${PROSE_MIN_PX}px. ` +
        "If one of these really is a label rather than prose, add it to " +
        "FURNITURE_SELECTORS deliberately:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });
});

describe("markup", () => {
  it("keeps every Tailwind alpha utility at AA contrast", () => {
    const offenders = alphaUtilities()
      .map((u) => {
        // Tokens are declared as --color-<name>; anything else is not ours to resolve, and a silent skip would be the failure this test exists to prevent, so an unknown token is reported rather than ignored.
        let ratio: number;
        try {
          const fg = hexToRgb(extractColor(u.token));
          ratio = contrastRatio(compositeOver(fg, paper, u.alpha), paper);
        } catch {
          return `${u.file}: text-${u.token}/${u.alpha * 100} — no --color-${u.token} token to measure against`;
        }
        return ratio >= 4.5
          ? null
          : `${u.file}: text-${u.token}/${u.alpha * 100} → ${ratio.toFixed(2)}:1`;
      })
      .filter((x): x is string => x !== null);

    expect(
      offenders,
      "These Tailwind alpha utilities fall below 4.5:1 against paper. " +
        "Use the .quiet class instead:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("has no inline style attributes, which style-src 'self' would block", () => {
    const offenders: string[] = [];

    for (const { file, markup } of MARKUP_FILES) {
      for (const m of markup.matchAll(/\sstyle="[^"]*"/g)) {
        offenders.push(`${file}:${m[0].trim()}`);
      }
    }

    expect(
      offenders,
      "style-src is 'self' with no 'unsafe-inline', so a style attribute in " +
        "markup is dropped by the browser and the element renders unstyled. " +
        "Use a class, or set the property through the CSSOM:\n" +
        offenders.join("\n")
    ).toEqual([]);
  });
});
