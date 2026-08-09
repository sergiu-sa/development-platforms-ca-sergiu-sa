/**
 * A briefing's public address, derived from its title once and never again.
 *
 * Slugs are assigned at creation and survive a retitle, so a link shared today still resolves after the curator changes their mind about the wording.
 * That is the whole reason the title is not the address.
 *
 * Pure and separately testable:
 * nothing here touches the database, and the random half is passed in rather than reached for, so the collision path can be exercised by a test instead of waited for.
 */

import { randomBytes } from "node:crypto";

/** How much of the title survives, before the suffix. */
export const MAX_SLUG_BASE = 80;

/** What a title with nothing alphanumeric in it becomes. */
export const SLUG_FALLBACK = "briefing";

/**
 * The title as a URL segment.
 *
 * Accents are folded rather than dropped, so "Café society" reads as "cafe-society" instead of "caf-society".
 * A title written in a script with no latin at all collapses to the fallback, which the suffix then makes unique;
 * an unhelpful address is better than a bare hyphen or an empty segment.
 */
export function slugifyTitle(title: string): string {
  const base = title
    .normalize("NFKD")
    // Combining marks left behind by the decomposition above.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BASE)
    // The slice can land mid-separator, which would leave a trailing hyphen butted against the suffix's own.
    .replace(/-+$/g, "");

  return base || SLUG_FALLBACK;
}

/**
 * Four hex characters of randomness.
 *
 * Enough that two curators titling a briefing identically do not fight over one URL, and short enough that the address still reads as words.
 * It is not a uniqueness guarantee - createBriefing retries on the unique index, which is the only thing that can actually promise it.
 */
export function randomSuffix(): string {
  return randomBytes(2).toString("hex");
}

/**
 * The finished address.
 *
 * Every slug ends in `-` plus the suffix, which has a side effect worth knowing:
 * no slug can ever equal a bare word, so a literal path segment added under /briefings later cannot be shadowed by somebody's title.
 */
export function briefingSlug(title: string, suffix: string): string {
  return `${slugifyTitle(title)}-${suffix}`;
}
