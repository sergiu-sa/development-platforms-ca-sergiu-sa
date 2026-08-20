/**
 * One curator's shelf: the header, the lede, the drafts band and the pager.
 *
 * Lives beside `list.ts` rather than in a module of its own because this page is briefings shown a different way, and `list.ts` was written for it - its own header says so.
 * A `curator/` module would import `briefing/` on its first line, which is the sibling-feature dependency the builder already opened once and nothing has closed.
 *
 * The design is direction B from `docs/prototype/profile.html`: the name, then the newest briefing drawn large, then the rest as the shelf's own cards.
 * Direction A was the same page without the lede, and it was rejected for being `/briefings` with a different title on it.
 */

import { escapeHtml, safeUrl } from "../lib/html";
import { chromeMarkup, footMarkup } from "../lib/chrome";
import { pagerMarkup } from "./pager";
import { dayMonthYear } from "../lib/time";
import { FAILED } from "./copy";
import { briefingCardMarkup, shorten } from "./list";
import { messageMarkup } from "./view";
import type { BriefingSummary, CuratorShelf } from "./types";

/** How much of the newest briefing's intro the lede shows. */
const LEDE_INTRO_LIMIT = 220;

function briefingCount(total: number): string {
  return total === 1 ? "1 briefing" : `${total} briefings`;
}

/**
 * The curator's name and what they have filed.
 *
 * The kicker's mark is blue rather than red: a curator is somebody's hand, not the machine's clock, which is the whole of the two-accent rule.
 *
 * **No date on a later page.** The header only ever knows the briefings on the page it was handed, so on page three `briefings[0]` is the twenty-first newest - and "Most recent 4 Jan" under a curator whose newest is from August is simply false. Page one draws the lede instead, which carries the date beside the briefing it belongs to.
 */
export function curatorHeadMarkup(
  shelf: CuratorShelf,
  options: { withDate: boolean }
): string {
  const facts = [`<span>${briefingCount(shelf.total)} filed</span>`];

  if (options.withDate && shelf.page === 1 && shelf.briefings[0]?.publishedAt) {
    facts.push(
      `<span class="quiet">Most recent ${escapeHtml(
        dayMonthYear(shelf.briefings[0].publishedAt)
      )}</span>`
    );
  }

  return (
    `<header class="prof-head">` +
    `<p class="prof-kicker m">` +
    `<span class="prof-mark" aria-hidden="true"></span> Curator</p>` +
    `<h1 class="prof-name">${escapeHtml(shelf.username)}</h1>` +
    (shelf.total > 0
      ? `<p class="prof-facts m">${facts.join("")}</p>`
      : // No facts line when there is nothing to state. "0 briefings filed" reads like a broken template, and the message below already says it in words.
      // The rule the line carried moves with it.
        "") +
    `</header>`
  );
}

/**
 * The newest briefing, drawn large.
 *
 * This is what makes a profile a front page rather than a filtered list, and it is the same move the desk makes with its lead story.
 * The photograph carries `alt=""` for the reason the card's does: it stands for the briefing, and the title beside it is the real label.
 */
export function ledeMarkup(briefing: BriefingSummary): string {
  const image = safeUrl(briefing.ledeImageUrl);
  const picture = image
    ? `<img class="prof-lede-shot" src="${escapeHtml(image)}" alt="" />`
    : `<span class="prof-lede-shot" aria-hidden="true"></span>`;

  const intro = briefing.intro
    ? `<p class="prof-lede-intro">${escapeHtml(shorten(briefing.intro, LEDE_INTRO_LIMIT))}</p>`
    : "";

  const stories =
    briefing.itemCount === 1 ? "1 story" : `${briefing.itemCount} stories`;

  const filed = briefing.publishedAt
    ? `<span class="quiet">${escapeHtml(dayMonthYear(briefing.publishedAt))}</span>`
    : "";

  return (
    `<div class="prof-lede">` +
    `<a class="prof-lede-link" href="/b/${encodeURIComponent(briefing.slug)}">` +
    picture +
    `<span class="prof-lede-words">` +
    `<span class="m quiet">Most recent</span>` +
    `<span class="prof-lede-title">${escapeHtml(briefing.title)}</span>` +
    intro +
    `<span class="bcard-facts m">` +
    `<span class="quiet">${stories}</span>` +
    filed +
    `</span></span></a></div>`
  );
}

/**
 * A whole page: the bar, the content, the footer.
 *
 * Every state this module renders is a complete document body, because the server emits nothing but an empty `#root`;
 *  so a state that forgot the frame would leave a reader with no wordmark and no way anywhere, which is exactly what the first build of this page did.
 * Going through one wrapper is what stops the next state added here from doing it again.
 */
function pageMarkup(inner: string): string {
  return chromeMarkup() + `<main>` + inner + `</main>` + footMarkup();
}

/** The id of the empty box the drafts band is written into. */
export const DRAFTS_SLOT = "prof-drafts";

/**
 * The box the drafts band lands in, drawn empty and always.
 *
 * The count needs a request the rest of the page does not, and it is only ever asked for on your own profile.
 * Drawing the shelf a second time when the answer arrives would throw away the focus of anybody who had already tabbed into it - the mistake the builder made and measured - so the slot goes down with the first paint and only its contents change.
 * Empty, it has no height and nothing focusable in it, so a visitor who is not the owner never learns it is there.
 */
function draftsSlotMarkup(): string {
  return `<div class="prof-drafts" id="${DRAFTS_SLOT}"></div>`;
}

/**
 * Your own drafts, on your own profile.
 *
 * A count and a way to the builder rather than a second shelf: `/build.html` already lists everything you have written, and the same data on two surfaces is two things to keep right.
 * What this earns its place for is the sentence - the profile is your public face, and the useful fact about a draft is that nobody else can see it.
 *
 * **Not a permission check.** It is drawn from a token the page decoded but cannot verify, so it decides what you are shown and never what you may do.
 * Every draft it counts came back from an endpoint that checked the same token properly.
 */
export function draftsBandMarkup(count: number): string {
  if (count < 1) return "";

  const drafts = count === 1 ? "1 draft" : `${count} drafts`;

  return (
    `<div class="prof-drafts-in">` +
    `<span class="m prof-drafts-n">${drafts}</span>` +
    `<span class="note quiet">Only you can see these.</span>` +
    `<a class="btn m" href="/build.html">Continue writing</a>` +
    `</div>`
  );
}

/**
 * The whole shelf.
 *
 * The drafts band is not built here. It needs a request of its own, so this leaves an empty slot for it and the page fills that in once the answer arrives.
 */
export function shelfMarkup(input: {
  shelf: CuratorShelf;
  href: (page: number) => string;
}): string {
  const { shelf, href } = input;
  const [newest, ...rest] = shelf.briefings;

  // The lede only leads on the first page.
  // On page two "Most recent" would be a lie about the briefing under it.
  const leads = shelf.page === 1 && newest;

  if (shelf.total === 0) {
    return pageMarkup(
      curatorHeadMarkup(shelf, { withDate: false }) +
        draftsSlotMarkup() +
        messageMarkup({
          level: "h2",
          heading: "Nothing filed yet",
          // Escaped even though `messageMarkup` is the one builder that does not, and even though USERNAME_PATTERN cannot produce a metacharacter.
          // Phase 9's guardianLink bug was precisely "every caller is safe by luck": the escape is the control, the pattern is the backstop.
          body: `When ${escapeHtml(shelf.username)} files a briefing, it appears here.`,
        })
    );
  }

  const cards = leads ? rest : shelf.briefings;

  return pageMarkup(
    curatorHeadMarkup(shelf, { withDate: !leads }) +
      draftsSlotMarkup() +
      (leads ? ledeMarkup(newest) : "") +
      // A real heading rather than a styled paragraph.
      // It is the only division on the page, so without it the outline is one h1 and nothing else, and there is no way to jump past the lede.
      (leads && cards.length > 0
        ? `<div class="prof-rest"><h2 class="m quiet prof-earlier">Earlier</h2></div>`
        : "") +
      (cards.length > 0
        ? `<ul class="bcards">${cards
            .map((briefing) => briefingCardMarkup(briefing, { byline: false }))
            .join("")}</ul>`
        : "") +
      pagerMarkup(shelf.page, shelf.pageSize, shelf.total, href)
  );
}

/** No curator has that name. */
export function noCuratorMarkup(): string {
  return pageMarkup(
    messageMarkup({
      heading: "No curator by that name",
      body: "This address does not belong to anybody. Check the spelling, or read what has been filed.",
    })
  );
}

/** The shelf could not be read. Says what happened and what to do. */
export function shelfErrorMarkup(): string {
  return pageMarkup(
    messageMarkup({ heading: "This shelf did not load", body: FAILED })
  );
}
