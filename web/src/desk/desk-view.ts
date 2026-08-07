/**
 * Drawing the desk.
 *
 * The card is the wire's, reused unchanged for the lead;
 * same markup, same five tone variants, same tokens.
 * That reuse is the design statement rather than a shortcut: someone who has just spent five minutes on the deck should recognise the desk as the same publication, shorter, and composed by them.
 *
 * Everything below the lead is a band, which the wire has no equivalent of, because a band carries the one fact only the desk knows;
 *  the time the reader kept the story.
 */

import { deleteDeskDecision } from "../lib/api";
import { escapeHtml, safeUrl } from "../lib/html";
import { dayMonth } from "../lib/time";
import { collapseShot, renderCard } from "../wire/card";
import { factsLine, storyImage } from "../wire/marks";
import type { Story } from "../wire/types";
import {
  composeEdition,
  dayDate,
  minutesOf,
  type ArchiveDay,
  type EditionFacts,
} from "./edition";
import type { DeskEntry } from "./types";

const EDITION_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * The headline links out, and it is the only link on a band.
 *
 * The row on the homepage learned this the other way round: three symmetrical labelled actions beat a link plus three, because a keyboard reader gets one stop per action rather than two that do the same thing.
 * Here there is only one action, Remove, so the headline can carry the read.
 */
function outbound(story: Story, inner: string): string {
  const href = safeUrl(story.url);
  if (!href) return inner;

  return (
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">` +
    `${inner}<span class="sr-only"> (opens in a new tab)</span></a>`
  );
}

/**
 * Remove, and the story's length beside it.
 *
 * Shared by the band and the lead, because the lead is a story on the desk like any other and a reader who cannot take the biggest one off is stuck with it.
 * The card itself is left untouched:
 * it belongs to the wire, and hanging a desk-only control inside it would be the coupling this file exists to avoid.
 */
function actsMarkup(minutes: number | null, title: string): string {
  // Escaped here rather than by the caller: this lands in an aria-label, and a parameter that silently requires pre-escaped input is one careless third caller away from an attribute-context injection.
  const safeTitle = escapeHtml(title);

  return (
    `<p class="band-acts">` +
    // mini-remove tints the hover red, which the wire's Remove deliberately does not.
    // The desk has no undo, so this is the one control in the product that cannot be taken back.
    `<button type="button" class="mini mini-remove m" data-act="remove" ` +
    `aria-label="Remove ${safeTitle} from your desk">Remove</button>` +
    // Absent for a live blog rather than floored to a number, because its word count is only what has been posted so far.
    (minutes === null ? "" : `<span class="m quiet">${minutes} min</span>`) +
    `</p>`
  );
}

function bandMarkup(entry: DeskEntry, now: Date): string {
  const source = storyImage(entry.story);
  const minutes = minutesOf(entry.story);
  const title = escapeHtml(entry.story.title);
  const kept = CLOCK.format(new Date(entry.decidedAt));

  return (
    `<article class="band" data-story-id="${Number(entry.storyId)}"` +
    `${minutes === null ? "" : ` data-m="${minutes}"`}` +
    `${source ? "" : ' data-shot="none"'}>` +
    `<span class="m band-t">` +
    `<span class="sr-only">Kept at </span>${kept}</span>` +
    (source
      ? `<figure class="band-shot"><img src="${escapeHtml(source)}" ` +
        `alt="${escapeHtml(entry.story.imageAlt ?? "")}" loading="lazy" ` +
        `decoding="async" /></figure>`
      : "") +
    `<div class="band-copy">` +
    `<p class="m band-f">${factsLine(entry.story, entry.story.section, now)}</p>` +
    `<h3 class="band-h">${outbound(entry.story, title)}</h3>` +
    (entry.story.standfirst
      ? `<p class="band-s">${escapeHtml(entry.story.standfirst)}</p>`
      : "") +
    actsMarkup(minutes, entry.story.title) +
    `</div></article>`
  );
}

export function renderEdition(
  root: HTMLElement,
  entries: readonly DeskEntry[],
  now: Date = new Date()
): void {
  const edition = composeEdition(entries);

  if (!edition.lead) {
    root.innerHTML =
      `<div class="desk-empty">` +
      `<h2 class="sec-title">Nothing kept on this day.</h2>` +
      `<p class="note">Everything you save on the wire lands here, dated ` +
      `and yours alone.</p>` +
      `<p><a class="btn btn-blue m" href="/index.html">Go to the wire</a></p>` +
      `</div>`;
    return;
  }

  root.innerHTML =
    `<div class="ed-lead" data-story-id="${Number(edition.lead.storyId)}">` +
    renderCard(edition.lead.story, now) +
    actsMarkup(minutesOf(edition.lead.story), edition.lead.story.title) +
    `</div>` +
    edition.sections
      .map(
        (section) =>
          `<section>` +
          `<div class="pillar"><h2>${escapeHtml(section.pillar)}</h2></div>` +
          section.entries.map((entry) => bandMarkup(entry, now)).join("") +
          `</section>`
      )
      .join("");

  // Through the CSSOM rather than a style attribute: the attribute is what the CSP blocks, and setProperty is not subject to it at all.
  // Same route phase 4 used for the measured tray height.
  for (const band of root.querySelectorAll<HTMLElement>(".band[data-m]")) {
    band.style.setProperty("--m", band.dataset.m!);
  }
}

/**
 * The edition's own facts line: the date at full strength, the rest quiet.
 * Takes the two numbers rather than the entries, so a Remove can adjust them instead of the page holding every story row alive to recompute them.
 */
export function renderMasthead(
  dateEl: HTMLElement,
  factsEl: HTMLElement,
  { storyCount, minutes }: EditionFacts,
  day: string
): void {
  dateEl.textContent = EDITION_DATE.format(dayDate(day));

  const stories = `${storyCount} ${storyCount === 1 ? "story" : "stories"}`;
  factsEl.textContent =
    minutes > 0 ? `${stories} · ${minutes} minutes` : stories;
}

export function renderArchive(
  nav: HTMLElement,
  strip: HTMLElement,
  days: readonly ArchiveDay[],
  current: string
): void {
  // Hidden only when the strip could not take the reader anywhere they are not already:
  // no editions at all, or exactly one and it is the one on screen.
  //
  // The rule used to be "fewer than two days", which stranded anybody whose saves were all on an earlier day;
  // they opened the desk, got today's empty state, and had no route to the edition they actually have.
  // That is every reader who does not use the site daily, on their second visit.
  const elsewhere = days.filter((entry) => entry.day !== current);
  nav.hidden = elsewhere.length === 0;
  if (nav.hidden) {
    strip.innerHTML = "";
    return;
  }

  strip.innerHTML = days
    .map(({ day, count, isToday }) => {
      const label = isToday ? "Today" : dayMonth(dayDate(day));
      // aria-current as well as the filled chip, so the edition being read is never signalled by appearance alone.
      const marker = day === current ? ' aria-current="page"' : "";

      return (
        `<a class="archive-day m" href="/desk.html?date=${escapeHtml(day)}"${marker}>` +
        `${label} <span class="quiet">${count}</span>` +
        `<span class="sr-only"> ${count === 1 ? "story" : "stories"}</span></a>`
      );
    })
    .join("");
}

/**
 * A stored image URL that no longer resolves leaves a broken-image icon in the middle of the edition.
 * Found on a real row: the Guardian drops assets for some older stories and nothing revalidates the cache.
 *
 * The listener is attached here rather than as an onerror attribute, because an inline handler is script and `script-src 'self'` blocks it.
 * An image that already failed before this runs fires no event, which the `complete` check catches;
 * in a browser `complete` is only true once the fetch has finished, so a pending image is never mistaken for a broken one.
 *
 * Mounted by the page rather than called from `renderEdition`, because it depends on real image loading:
 * a DOM without it reports every image as complete with no dimensions, which is indistinguishable from every image being broken.
 */
export function mountBrokenImageGuard(root: HTMLElement): void {
  const drop = (image: Element): void => {
    // Both the band and the card collapse to one column on the card's own attribute, so the copy takes the space rather than leaving a hole.
    // The attribute belongs to the card, so the card sets it.
    const holder = image.closest(".band, .card");
    image.closest("figure")?.remove();
    if (holder) collapseShot(holder);
  };

  // One listener for the whole edition rather than one per image. `error` does not bubble but it does capture, so the capturing phase catches every image under this root;
  // including any drawn later.
  root.addEventListener(
    "error",
    (event) => {
      const image = event.target as Element | null;
      if (image?.tagName === "IMG") drop(image);
    },
    true
  );

  // A failure that already happened fires no event, so those are swept once.
  for (const image of root.querySelectorAll("img")) {
    if (image.complete && image.naturalWidth === 0) drop(image);
  }
}

/**
 * The desk could not be read.
 *
 * Lives here beside the empty state it must not be mistaken for.
 * "We could not ask" and "you kept nothing" are different sentences, and keeping both in one module is what stops the second one drifting into the first.
 */
export function showDeskError(root: HTMLElement): void {
  root.innerHTML =
    `<div class="desk-empty">` +
    `<h2 class="sec-title">Your desk could not be loaded.</h2>` +
    `<p class="note">Nothing has been lost. Reload the page to try again.</p>` +
    `</div>`;
}

/**
 * Remove waits for the server, and that is the opposite of what the homepage does on purpose.
 *
 * The homepage repaints a decision immediately because a lost skip costs nothing and the wire is still in front of the reader.
 * This page claims to be the truth about their desk, so showing a story gone when the request failed would be a lie on the one screen that must not tell one.
 */
export function mountRemove(
  root: HTMLElement,
  onRemoved: (storyId: number) => void
): void {
  root.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>("[data-act='remove']");
    // The lead and a band are both removable, and both carry the story id on the element the whole story lives in.
    const holder = button?.closest<HTMLElement>(".band, .ed-lead");
    if (!button || !holder) return;

    const storyId = Number(holder.dataset.storyId);
    if (!Number.isInteger(storyId)) return;

    // The label moves with the text.
    // An aria-label overrides the contents it sits on, so swapping only `textContent` changes what is seen and nothing of what is heard;
    // on the page whose whole promise is that it does not say a story is gone when it is not.
    const label =
      button.getAttribute("aria-label") ?? "Remove this story from your desk";

    button.disabled = true;
    button.textContent = "Removing";
    button.setAttribute("aria-label", label.replace(/^Remove /, "Removing "));
    holder.querySelector(".band-msg")?.remove();

    const { status } = await deleteDeskDecision(storyId);

    // 200 is the only success.
    // The endpoint answers 200 whether or not a row matched;
    // deleting something already gone is not an error;
    // so anything else is a refusal or an outage, and the story stays on screen saying so rather than vanishing on a request that changed nothing.
    // The caller redraws the edition from what is left rather than this stitching the DOM.
    // Removing the node here as well was how the page ended up with an orphaned pillar heading, a lead slot with no lead, and an archive strip still counting the story that had gone: three places each tracking the same removal, and only one of them right.
    if (status === 200) {
      onRemoved(storyId);
      return;
    }

    button.disabled = false;
    button.textContent = "Remove";
    button.setAttribute("aria-label", label);

    // The live region has to be in the document before its text changes, or several screen readers never announce it.
    // Inserted empty, then filled.
    const message = document.createElement("span");
    message.className = "m band-msg";
    message.setAttribute("role", "status");
    holder.querySelector(".band-acts")?.append(message);
    message.textContent = "Not removed. Try again.";
  });
}
