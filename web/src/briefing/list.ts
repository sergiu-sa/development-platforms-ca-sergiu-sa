/**
 * The card that stands for a whole briefing, and the page that lists them.
 *
 * Written as its own module rather than inside the page, because phase 11's curator shelf shows the same card for one person's briefings.
 * The only thing that differs there is which briefings it is handed.
*
 * The card is a link, not a button with a click handler:
 * a briefing has a real address that is worth copying, opening in a new tab and sharing, and that is the whole point of the page it leads to.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { FAILED } from "./copy";
import { messageMarkup } from "./view";
import type { BriefingSummary } from "./types";

/** How much of an intro a card shows before it starts to crowd the title. */
const INTRO_LIMIT = 140;

function shorten(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const cut = text.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}...`;
}

/**
 * One briefing, as a card.
 *
 * The photograph carries `alt=""` deliberately:
 *  it is the lede's picture standing in for the briefing, and the title beside it is the real label.
 * Describing it twice is noise to anyone listening.
 */
export function briefingCardMarkup(briefing: BriefingSummary): string {
  const image = safeUrl(briefing.ledeImageUrl);
  const picture = image
    ? `<img class="bcard-shot" src="${escapeHtml(image)}" alt="" loading="lazy" />`
    : `<span class="bcard-shot" aria-hidden="true"></span>`;

  const intro = briefing.intro
    ? `<p class="bcard-intro">${escapeHtml(shorten(briefing.intro, INTRO_LIMIT))}</p>`
    : "";

  const stories =
    briefing.itemCount === 1 ? "1 story" : `${briefing.itemCount} stories`;

  return (
    `<li class="bcard">` +
    `<a class="bcard-link" href="/b/${encodeURIComponent(briefing.slug)}">` +
    picture +
    `<span class="bcard-words">` +
    `<span class="bcard-title">${escapeHtml(briefing.title)}</span>` +
    intro +
    `<span class="bcard-facts m">` +
    `<span>By ${escapeHtml(briefing.author.username)}</span>` +
    `<span class="quiet">${stories}</span>` +
    `</span></span></a></li>`
  );
}

/** Every filed briefing, newest first. */
export function briefingListMarkup(briefings: BriefingSummary[]): string {
  return (
    `<ul class="bcards">` + briefings.map(briefingCardMarkup).join("") + `</ul>`
  );
}

/**
 * Nobody has filed anything yet.
 *
 * An invitation rather than a shrug, and it does not spend `-30-`, which the design gives exactly two homes: the deck's cleared state and the footer.
 *
 * `h2` rather than `h1`: this page already has one, above the shelf.
 */
export function noBriefingsMarkup(): string {
  return messageMarkup({
    level: "h2",
    heading: "Nothing filed yet",
    body: "When somebody files a briefing, it appears here.",
  });
}

/** The listing could not be read. Says what happened and what to do. */
export function listErrorMarkup(): string {
  return messageMarkup({
    level: "h2",
    heading: "The briefings did not load",
    body: FAILED,
  });
}
