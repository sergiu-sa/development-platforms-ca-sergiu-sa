/**
 * Slug generation, tested where it is pure.
 *
 * The address is derived once and then frozen for the life of the briefing, so a mistake here is permanent in a way most bugs are not: it is baked into every link anybody shared.
 */

import { describe, it, expect } from "vitest";
import {
  briefingSlug,
  randomSuffix,
  slugifyTitle,
  MAX_SLUG_BASE,
  SLUG_FALLBACK,
} from "../src/modules/briefings/briefings.slug.js";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTitle("Weekly Climate Roundup")).toBe(
      "weekly-climate-roundup"
    );
  });

  it("collapses runs of punctuation into one hyphen", () => {
    expect(slugifyTitle("What now?! -- for Gaza")).toBe("what-now-for-gaza");
  });

  it("trims separators off both ends", () => {
    expect(slugifyTitle("  ...Budget day...  ")).toBe("budget-day");
  });

  // Names are the common case in a news product, and "caf-society" reads as a typo where "cafe-society" reads as an address.
  it("folds accents rather than dropping the letters", () => {
    expect(slugifyTitle("Café society in Málaga")).toBe(
      "cafe-society-in-malaga"
    );
  });

  it("falls back for a title with nothing latin in it", () => {
    expect(slugifyTitle("новости дня")).toBe(SLUG_FALLBACK);
    expect(slugifyTitle("!!!")).toBe(SLUG_FALLBACK);
  });

  it("truncates to the base limit", () => {
    const long = slugifyTitle("a".repeat(200));

    expect(long).toHaveLength(MAX_SLUG_BASE);
  });

  // The cut can land on a separator, and a trailing hyphen would butt against the suffix's own and read as an empty word.
  it("never ends in a hyphen after truncation", () => {
    const title = `${"a".repeat(MAX_SLUG_BASE - 1)} tail`;
    const slug = slugifyTitle(title);

    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("a".repeat(MAX_SLUG_BASE - 1));
  });
});

describe("briefingSlug", () => {
  it("joins the base and the suffix", () => {
    expect(briefingSlug("Weekly Climate Roundup", "7f3a")).toBe(
      "weekly-climate-roundup-7f3a"
    );
  });

  // Load-bearing beyond tidiness: because every slug carries a suffix, no title can produce one that shadows a literal path segment added under /briefings later.
  it("always carries a suffix, so no slug is ever a bare word", () => {
    for (const title of ["mine", "new", "!!!", "Drafts"]) {
      expect(briefingSlug(title, randomSuffix())).toMatch(/-[0-9a-f]{4}$/);
    }
  });
});

describe("randomSuffix", () => {
  it("is four hex characters", () => {
    expect(randomSuffix()).toMatch(/^[0-9a-f]{4}$/);
  });

  it("varies", () => {
    const seen = new Set(Array.from({ length: 50 }, () => randomSuffix()));

    expect(seen.size).toBeGreaterThan(1);
  });
});
