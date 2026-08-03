/**
 * The card: one component, five variants.
 *
 * The variant comes from the Guardian's tone tag and nothing else. Never match
 * a headline for "- live" or guess from a section; the tag is authoritative
 * and the headline is not.
 *
 * Every variant carries the same fields and the same tokens. Only order, size
 * and weight change, which is why this is one function with an attribute
 * rather than five components.
 *
 * The attribute is `data-variant`, where the design spec says `data-tone`.
 * Same idea, more honest name: a review that arrives without a star rating is
 * drawn as News, and an attribute called `tone` reading `news` for a story
 * whose tone is `reviews` would be a lie in the DOM.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { readingTimeMinutes } from "../lib/reading-time";
import { storySlug } from "../lib/slug";
import { relativeTime } from "../lib/time";
import type { Story, Variant } from "./types";

export function cardVariant(tone: string, starRating: number | null): Variant {
  switch (tone) {
    case "minutebyminute":
      return "live";
    case "comment":
      return "opinion";
    case "features":
      return "feature";
    case "reviews":
      // Reviews do not always carry a rating, and the whole point of the
      // variant is the rating. Without one it is an ordinary story.
      //
      // Tested for absence, not for truthiness: Guardian ratings run 0 to 5
      // and the backend stores a zero, so `starRating ? …` would throw away a
      // real one-star-short verdict and draw a panned film as ordinary news.
      return starRating === null || starRating === undefined
        ? "news"
        : "review";
    default:
      // Includes "news" and anything the Guardian starts sending that this
      // build has never heard of.
      return "news";
  }
}

/**
 * The star rating, drawn as filled squares.
 *
 * The row is a graphic, so it is hidden from assistive technology and the
 * rating is given as text beside it. A screen reader announcing five
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
 * Section, time, reading time and rating - the furniture above the headline.
 *
 * `quiet` is applied span by span rather than to the row, and that is not
 * fussiness. Opacity on a parent composites the whole subtree, so a red "Live"
 * inside a dimmed row is painted at 3.2:1 and fails AA with no way for the
 * child to opt out. Dimming only what is genuinely secondary keeps the one
 * coloured word at full strength.
 */
function factsMarkup(story: Story, variant: Variant, now: Date): string {
  const parts: string[] = [];

  // Live carries a dot and the word, because colour is never the only signal.
  if (variant === "live") parts.push(`<span class="live">Live</span>`);

  if (story.section) {
    parts.push(`<span class="quiet">${escapeHtml(story.section)}</span>`);
  }

  parts.push(
    `<time class="quiet" datetime="${escapeHtml(story.publishedAt)}">` +
      `${escapeHtml(relativeTime(story.publishedAt, now))}</time>`
  );

  const minutes = readingTimeMinutes(story.wordCount, story.tone);
  if (minutes !== null) {
    parts.push(`<span class="quiet">${minutes} min read</span>`);
  }

  // Absence, not truthiness - a zero-star review has a rating and it is news.
  if (story.starRating !== null && story.starRating !== undefined) {
    parts.push(starsMarkup(story.starRating));
  }

  return parts.join("");
}

/**
 * The photograph. Prefers the 1000px asset, falls back to the 500px thumbnail
 * for the rows stored before phase 1, and renders nothing at all when there is
 * neither - the copy takes the full card instead.
 *
 * Real alt text from the API where it exists. Where it does not, `alt=""` is
 * deliberate: an invented description is worse than none, and the headline
 * beside it already carries the meaning.
 *
 * The source runs through `safeUrl()` as well as `escapeHtml()`, the same as
 * the story link does. Escaping alone stops an attribute breaking out but says
 * nothing about the scheme, and this is third-party content. `img-src` in the
 * CSP would catch it too, so this is the second lock rather than the only one.
 */
function shotMarkup(story: Story): string {
  const src = safeUrl(story.imageUrl) ?? safeUrl(story.thumbnailUrl);
  if (!src) return "";

  const credit = story.imageCredit
    ? `<figcaption class="m">${escapeHtml(story.imageCredit)}</figcaption>`
    : "";

  return (
    `<figure class="shot">` +
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(story.imageAlt ?? "")}" />` +
    `${credit}</figure>`
  );
}

/**
 * The word "By", unless the Guardian has already supplied one.
 *
 * Found on a real story, not in a test: `byline` is free text and sometimes
 * carries its own preposition - "Exclusive by Nick Ames and Matt Hughes" -
 * which rendered as "BY EXCLUSIVE BY NICK AMES". Names with "by" inside them
 * are unaffected, because the test is for the standalone word.
 */
function bylineLabel(byline: string): string {
  return /\bby\b/i.test(byline) ? "" : `<span class="quiet">By</span> `;
}

export function renderCard(story: Story, now: Date = new Date()): string {
  const variant = cardVariant(story.tone, story.starRating);
  const shot = shotMarkup(story);
  const byline = story.byline ? escapeHtml(story.byline) : "";

  // A comment piece belongs to its writer, so the writer leads and the byline
  // line underneath would only repeat them.
  const writer =
    variant === "opinion" && byline ? `<p class="writer">${byline}</p>` : "";
  const bylineLine =
    variant !== "opinion" && byline
      ? `<p class="byline m">${bylineLabel(story.byline!)}<b>${byline}</b></p>`
      : "";

  const standfirst = story.standfirst
    ? `<p class="stand">${escapeHtml(story.standfirst)}</p>`
    : "";

  // The wire is third-party content, so a link is rendered only if it is
  // really an http(s) URL. Anything else gets no link rather than a dead one.
  const href = safeUrl(story.url);
  const source = href
    ? `<a class="src m" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">` +
      `Read the full story at the Guardian <span aria-hidden="true">&#8599;</span>` +
      `<span class="sr-only">(opens in a new tab)</span></a>`
    : "";

  return (
    `<article class="card" data-variant="${variant}"` +
    `${shot ? "" : ' data-shot="none"'}>` +
    shot +
    `<div class="copy">` +
    `<p class="slugline m">` +
    `<span class="slugline-id">${escapeHtml(storySlug(story.section, story.id))}</span>` +
    `${story.pillar ? `<span class="quiet">${escapeHtml(story.pillar)}</span>` : ""}` +
    `</p>` +
    `<p class="facts m">${factsMarkup(story, variant, now)}</p>` +
    writer +
    `<h2 class="headline">${escapeHtml(story.title)}</h2>` +
    standfirst +
    bylineLine +
    source +
    `</div></article>`
  );
}
