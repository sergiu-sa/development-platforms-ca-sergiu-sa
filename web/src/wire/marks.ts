/**
 * The furniture the card and the row both draw.
 *
 * These started private on the card. The browse row needs the same star
 * squares, the same rule about the word "By", the same facts line and the same
 * outbound link, and a second copy of any of them is a copy free to drift -
 * the byline rule in particular was found against real Guardian data and would
 * be easy to write again slightly wrong.
 *
 * The byline rule is exported as the question rather than as markup, because
 * the card sets the label in `.quiet` beside a bold name and the row does not.
 * Sharing the decision is the point; sharing the styling would be a coupling.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { readingTimeMinutes } from "../lib/reading-time";
import { relativeTime } from "../lib/time";
import type { Story } from "./types";

/**
 * A live blog, asked of the tone tag directly.
 *
 * Not `cardVariant(...) === "live"`: that is the card's presentation decision,
 * and a change to its precedence should not silently move the row's dot. The
 * tag is authoritative and the headline is never consulted.
 */
function isLive(tone: string): boolean {
  return tone === "minutebyminute";
}

/**
 * A star rating, drawn as filled squares.
 *
 * The row of squares is a graphic, so it is hidden from assistive technology
 * and the rating is given as text beside it. A screen reader announcing five
 * indistinguishable squares tells the reader nothing.
 */
function starsMarkup(rating: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  const squares = Array.from(
    { length: 5 },
    (_, i) => `<i${i < filled ? ' class="on"' : ""}></i>`
  ).join("");

  return (
    `<span class="stars" aria-hidden="true">${squares}</span>` +
    `<span class="sr-only">Rated ${filled} out of 5</span>`
  );
}

/**
 * Whether a byline still needs the word "By" in front of it.
 *
 * Found on a real story, not in a test: `byline` is free text and sometimes
 * carries its own preposition - "Exclusive by Nick Ames and Matt Hughes" -
 * which rendered as "BY EXCLUSIVE BY NICK AMES". Names with "by" inside them
 * are unaffected, because the test is for the standalone word.
 */
export function needsByLabel(byline: string): boolean {
  return !/\bby\b/i.test(byline);
}

/**
 * The facts above a headline, in the order both surfaces print them: live,
 * where it came from, when, how long it takes, how good it was.
 *
 * `place` is the caller's, because it is the one part that genuinely differs -
 * the card names the section, the list has room for the pillar as well.
 *
 * `quiet` is applied span by span rather than to the row, and that is not
 * fussiness. Opacity on a parent composites the whole subtree, so a red "Live"
 * inside a dimmed row is painted at 3.2:1 and fails AA with no way for the
 * child to opt out. Dimming only what is genuinely secondary keeps the one
 * coloured word at full strength.
 */
export function factParts(
  story: Story,
  place: string | null,
  now: Date
): string[] {
  const parts: string[] = [];

  // Live carries a dot and the word, because colour is never the only signal.
  if (isLive(story.tone)) parts.push(`<span class="live">Live</span>`);

  if (place) parts.push(`<span class="quiet">${escapeHtml(place)}</span>`);

  parts.push(
    `<time class="quiet" datetime="${escapeHtml(story.publishedAt)}">` +
      `${escapeHtml(relativeTime(story.publishedAt, now))}</time>`
  );

  // Null for a live blog, whose wordcount is only what has been posted so far.
  const minutes = readingTimeMinutes(story.wordCount, story.tone);
  if (minutes !== null) {
    parts.push(`<span class="quiet">${minutes} min read</span>`);
  }

  // Absence, not truthiness - a zero-star review has a rating and it is news.
  if (story.starRating !== null && story.starRating !== undefined) {
    parts.push(starsMarkup(story.starRating));
  }

  return parts;
}

/**
 * A link out to the Guardian.
 *
 * The wire is somebody else's, so the href goes through `safeUrl` as well as
 * being escaped: escaping stops an attribute breaking out but says nothing
 * about the scheme, and a `javascript:` href is script execution. Anything
 * that is not really http(s) gets no link rather than a dead one.
 *
 * The arrow is decorative and the destination is announced instead, because a
 * link that opens a new tab without saying so is a small betrayal.
 */
export function guardianLink(
  url: string,
  className: string,
  label: string,
  spoken: string
): string {
  const href = safeUrl(url);
  if (!href) return "";

  return (
    `<a class="${className}" href="${escapeHtml(href)}" target="_blank" ` +
    `rel="noopener noreferrer">${label} <span aria-hidden="true">&#8599;</span>` +
    `<span class="sr-only">${spoken} (opens in a new tab)</span></a>`
  );
}
