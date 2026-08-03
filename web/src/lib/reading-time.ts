const WORDS_PER_MINUTE = 230;

/**
 * Minutes to read, or null where the number would be a lie.
 *
 * Live blogs are excluded deliberately. Their word count is only what has been
 * posted so far, so "14 min read" on a running blog is wrong the moment it is
 * printed and grows more wrong all afternoon.
 *
 * That rule lives here rather than in the card because the browse row shows
 * reading time too. Put it in one caller and the second one has to remember
 * it.
 *
 * Takes primitives rather than a Story so `lib` never imports from `wire` -
 * dependencies point one way only.
 */
export function readingTimeMinutes(
  wordCount: number | null | undefined,
  tone: string
): number | null {
  if (tone === "minutebyminute") return null;
  if (!wordCount || wordCount <= 0) return null;

  // Rounded, then floored at 1: a 90-word brief rounds to zero minutes, and
  // "0 min read" reads as a bug rather than as a short story.
  return Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE));
}
