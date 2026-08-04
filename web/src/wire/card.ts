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
import { storySlug } from "../lib/slug";
import { factParts, guardianLink, needsByLabel } from "./marks";
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
 * Section, time, reading time and rating - the furniture above the headline.
 *
 * The parts themselves live in `marks.ts`, because the browse row prints the
 * same five in the same order and a second copy would be free to drift.
 */
function factsMarkup(story: Story, now: Date): string {
  return factParts(story, story.section, now).join("");
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
      ? `<p class="byline m">` +
        `${needsByLabel(story.byline!) ? `<span class="quiet">By</span> ` : ""}` +
        `<b>${byline}</b></p>`
      : "";

  const standfirst = story.standfirst
    ? `<p class="stand">${escapeHtml(story.standfirst)}</p>`
    : "";

  const source = guardianLink(
    story.url,
    "src m",
    "Read the full story at the Guardian",
    ""
  );

  return (
    `<article class="card" data-variant="${variant}"` +
    `${shot ? "" : ' data-shot="none"'}>` +
    shot +
    `<div class="copy">` +
    `<p class="slugline m">` +
    `<span class="slugline-id">${escapeHtml(storySlug(story.section, story.id))}</span>` +
    `${story.pillar ? `<span class="quiet">${escapeHtml(story.pillar)}</span>` : ""}` +
    `</p>` +
    `<p class="facts m">${factsMarkup(story, now)}</p>` +
    writer +
    `<h2 class="headline">${escapeHtml(story.title)}</h2>` +
    standfirst +
    bylineLine +
    source +
    `</div></article>`
  );
}
