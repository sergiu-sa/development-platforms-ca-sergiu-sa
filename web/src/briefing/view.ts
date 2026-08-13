/**
 * The briefing page, as markup.
 *
 * Two builders and nothing else: the stage holds one story, the index holds the whole briefing.
 * Both are pure - they take data and return a string - so the page's shape can be tested without a DOM and without a server.
 *
 * The split is not cosmetic.
 * The index is painted once and never redrawn, because redrawing it would destroy the focus of anyone who tabbed into it;
 * only the stage is repainted when the reader moves.
 * That is the same paint-versus-redraw rule `browse.ts` follows, and keeping the two in separate functions is what makes it hard to get wrong later.
 */

import { escapeHtml } from "../lib/html";
import { readingTimeMinutes } from "../lib/reading-time";
import { guardianLink, isLive, needsByLabel, storyImage } from "../wire/marks";
import type { Story } from "../wire/types";
import { FAILED, WIRE_CTA, WIRE_HREF } from "./copy";
import { positionLabel } from "./state";
import type { Briefing, BriefingItem } from "./types";

/**
 * The facts under a headline.
 *
 * Built here rather than taken from `marks.factParts` because this surface composes them differently:
 * a briefing names the journalist and drops the timestamp, where the card spends that room the other way round.
 * A briefing is permanent, so "3 days ago" ages badly on it in a way it does not on the wire.
 *
 * The predicates are still shared - `isLive`, `needsByLabel` and `readingTimeMinutes` all come from the modules that own them - so only the order and the markup differ, never a rule.
 *
 * `quiet` is applied span by span rather than to the row. Opacity on a parent composites the whole subtree, so a red "Live" inside a dimmed row paints at 3.2:1 and the child cannot opt out.
 */
function factsMarkup(story: Story): string {
  const parts: string[] = [];

  // A dot and the word, because colour is never the only signal.
  if (isLive(story.tone)) {
    parts.push(`<span class="live">Live</span>`);
  }

  if (story.byline) {
    const label = needsByLabel(story.byline) ? "By " : "";
    parts.push(
      `<span class="quiet">${escapeHtml(label + story.byline)}</span>`
    );
  }

  if (story.section) {
    parts.push(`<span class="quiet">${escapeHtml(story.section)}</span>`);
  }

  // Null for a live blog, whose wordcount is only what has been posted so far.
  const minutes = readingTimeMinutes(story.wordCount, story.tone);
  if (minutes !== null) {
    parts.push(`<span class="quiet">${minutes} min read</span>`);
  }

  return `<div class="briefing-facts m">${parts.join("")}</div>`;
}

/** The photograph, with the credit the Guardian supplied. */
function figureMarkup(story: Story): string {
  const src = storyImage(story);
  if (!src) return "";

  const credit = story.imageCredit
    ? `<figcaption class="m quiet briefing-credit">` +
      `${escapeHtml(story.imageCredit)}</figcaption>`
    : "";

  return (
    `<figure class="briefing-figure">` +
    `<img class="briefing-shot" src="${escapeHtml(src)}" ` +
    `alt="${escapeHtml(story.imageAlt ?? "")}" />${credit}</figure>`
  );
}

/**
 * One story on its pedestal.
 *
 * `index` rather than `item.position` decides the number shown:
 * the reader is moving through an array, and if the two ever disagreed the number under the reader's finger should match the one in the index beside it.
 */
export function stageMarkup(item: BriefingItem, index: number): string {
  const { story } = item;

  const lede = index === 0 ? " &mdash; the lede" : "";
  const note = item.note
    ? `<p class="briefing-note">${escapeHtml(item.note)}</p>`
    : "";

  return (
    `<p class="m"><span>${positionLabel(index)}</span>${lede}</p>` +
    note +
    figureMarkup(story) +
    `<h2 class="briefing-headline">${escapeHtml(story.title)}</h2>` +
    factsMarkup(story) +
    guardianLink(
      story.url,
      "briefing-read m",
      "Read at the Guardian",
      story.title
    )
  );
}

/** Minutes across the whole briefing. Live blogs contribute nothing. */
function totalMinutes(briefing: Briefing): number {
  return briefing.items.reduce(
    (sum, item) =>
      sum + (readingTimeMinutes(item.story.wordCount, item.story.tone) ?? 0),
    0
  );
}

/** One row in the index. */
function entryMarkup(
  item: BriefingItem,
  index: number,
  current: number
): string {
  const src = storyImage(item.story);
  const thumb = src
    ? `<img class="briefing-thumb" src="${escapeHtml(src)}" alt="" loading="lazy" />`
    : `<span class="briefing-thumb" aria-hidden="true"></span>`;

  return (
    `<button type="button" class="briefing-entry" data-go="${index}" ` +
    `aria-current="${index === current}">` +
    `<span class="m briefing-entry-n">${positionLabel(index)}</span>` +
    thumb +
    `<span class="briefing-entry-title">${escapeHtml(item.story.title)}</span>` +
    `</button>`
  );
}

/**
 * The whole briefing, standing beside the story.
 *
 * The current entry is marked three ways; a tint, a blue number and `aria-current`; 
 * because colour is never the only signal and a screen reader needs to be told which one is on screen.
 */
export function indexMarkup(briefing: Briefing, current: number): string {
  const minutes = totalMinutes(briefing);
  const stories = briefing.items.length;

  const intro = briefing.intro
    ? `<p class="briefing-intro">${escapeHtml(briefing.intro)}</p>`
    : "";

  return (
    `<div class="briefing-index-head">` +
    `<p class="briefing-kicker m">` +
    `<span class="briefing-mark" aria-hidden="true"></span> Briefing</p>` +
    `<h1 class="briefing-title">${escapeHtml(briefing.title)}</h1>` +
    intro +
    `<p class="briefing-facts m">` +
    `<span>By ${escapeHtml(briefing.author.username)}</span>` +
    `<span class="quiet">${stories} ${stories === 1 ? "story" : "stories"}</span>` +
    `<span class="quiet">${minutes} min read</span>` +
    `</p></div>` +
    `<nav aria-label="Stories in this briefing">` +
    briefing.items
      .map((item, index) => entryMarkup(item, index, current))
      .join("") +
    `</nav>` +
    `<div class="briefing-foot">` +
    `<p class="m quiet briefing-keys">Use the arrow keys to move between stories</p>` +
    `<p class="m"><a href="/index.html">Read the wire</a></p>` +
    `</div>`
  );
}

/**
 * A dead end, said the same way every time.
 *
 * Five of these existed as near-identical blocks before this was written, and they had already drifted:
 *  two carried byte-identical prose, and the way back to the wire was stated in six places.
 * One builder means changing the way out of a dead end is one edit rather than a grep that half-finds it.
 */
export function messageMarkup(input: {
  heading: string;
  body: string;
  /** h1 on a page that is only this message; h2 where a page heading exists. */
  level?: "h1" | "h2";
  /** Anything that belongs between the sentence and the way out. */
  extra?: string;
}): string {
  const { heading, body, level = "h1", extra = "" } = input;

  return (
    `<div class="briefing-message">` +
    `<${level} class="briefing-title">${heading}</${level}>` +
    `<p class="note">${body}</p>` +
    extra +
    `<p class="m"><a href="${WIRE_HREF}">${WIRE_CTA}</a></p>` +
    `</div>`
  );
}

/**
 * A briefing that is not there.
 *
 * The same words whether the address never existed or belongs to somebody else's draft, because the API answers those identically and this page must not be the thing that tells them apart.
 *
 * The sign-in line appears only when a token is stored, which is the whole fix for an author whose session expired:
 * `optionalAuth` folds an expired token into anonymous, so their own draft answers 404 and nothing would otherwise suggest signing in again.
 *
 * `here` is passed in rather than read off `window`, so this module stays pure and its tests need no DOM.
 * The caller already knows where it is.
 */
export function notFoundMarkup(hasToken: boolean, here: string): string {
  return messageMarkup({
    heading: "Not found",
    body:
      "That briefing does not exist." +
      (hasToken ? " If it is yours, your session may have expired." : ""),
    extra: hasToken
      ? `<p class="m"><a href="/login.html?next=${encodeURIComponent(here)}">` +
        `Sign in</a></p>`
      : "",
  });
}

/** A draft with nothing in it yet. Only its author can ever see this. */
export function emptyMarkup(): string {
  return messageMarkup({
    heading: "Nothing filed here yet",
    body: "This briefing has no stories in it.",
  });
}

/** The read failed. States what happened and what to do, and does not apologise. */
export function errorMarkup(): string {
  return messageMarkup({ heading: "This briefing did not load", body: FAILED });
}

/** A draft, seen by its author. Says so, rather than looking published. */
export function draftBandMarkup(): string {
  return `<p class="briefing-draft m">Draft &mdash; only you can see this</p>`;
}
