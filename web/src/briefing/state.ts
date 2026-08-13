/**
 * Which story the reader is on, and how that survives the address bar.
 *
 * Pure and DOM-free on purpose: the page owns the `history` call and the`location` read, and everything decidable about them is decided here where a test can reach it without a browser.
 */

/**
 * A zero-based index as the 1-based, padded position a reader sees.
 *
 * Lives here rather than in the view because the address and the page have to agree on it:
 * `#03` in the URL and `03` on the stage are the same number, and two paddings that could drift is one too many.
 */
export function positionLabel(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** The position, padded, as it appears in the address. */
export function hashForIndex(index: number): string {
  return `#${positionLabel(index)}`;
}

/** Keeps an index inside the briefing. Both ends stop rather than wrap. */
export function clampIndex(index: number, count: number): number {
  if (count <= 0) return 0;

  return Math.min(Math.max(index, 0), count - 1);
}

/**
 * The story a URL is asking for.
 *
 * An allow-list, matching `safeNext` in `lib/api.ts` rather than a deny-list:
 * one or two digits, nothing else, and the result has to be a position this briefing actually has.
 *
 * Out of range returns the lede rather than clamping to the last story.
 * A shared link to story 9 of a briefing that now holds 6 is stale, and answering it with the last story would show the reader something they were not sent and make it look deliberate.
 */
export function indexFromHash(hash: string, count: number): number {
  const match = /^#(\d{1,2})$/.exec(hash);
  if (!match) return 0;

  const position = Number(match[1]);
  if (position < 1 || position > count) return 0;

  return position - 1;
}
