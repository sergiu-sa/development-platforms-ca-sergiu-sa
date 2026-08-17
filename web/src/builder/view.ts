/**
 * The galley: the briefing as one document, read top to bottom in its own order, with the writing turned on.
 *
 * Chosen over a two-pane spread after both were built and driven at 390 and 1440.
 * The spread is the prettier screenshot and the worse working surface: below 62rem it collapses to story-then-index, so changing story means scrolling past a full-bleed photograph and back, and it shows one note at a time while order and rhythm are the whole point of a briefing.
 *
 * Markup only, and no state: every function here takes what it draws and returns a string, so the page owns the DOM and these can be tested without one.
 * Everything interpolated goes through `escapeHtml`, including the textarea bodies - a note containing `</textarea>` would otherwise close the field and put the rest of it in the document.
 */

import { escapeHtml } from "../lib/html";
import { factsLine, storyImage } from "../wire/marks";
import { readingTimeMinutes } from "../lib/reading-time";
// The reading view owns this, and its comment says why it lives in one place:
// two paddings that could drift is one too many, and the same story wears the same number on both screens.
import { positionLabel } from "../briefing/state";
import type { BriefingSummary } from "../briefing/types";
import type { SaveStatus } from "./save";
import { BUILDER_COPY as COPY, storyCount } from "./copy";
import {
  fileRefusal,
  INTRO_MAX,
  NOTE_MAX,
  TITLE_MAX,
  unwrittenCount,
  type BuilderItem,
  type BuilderState,
} from "./state";

/** The three save states are already the three key names, so this is an index rather than a ladder. */
export const SAVE_WORD: Record<SaveStatus, string> = {
  saved: COPY.saved,
  saving: COPY.saving,
  unsaved: COPY.unsaved,
};

/**
 * A writing surface.
 *
 * A textarea in every case, including the title. Titles run to 200 characters and a single-line input clips them with no way to see the end - found at 390 on the prototype, where the approved title was cut mid-word.
 */
function field(
  id: string,
  className: string,
  value: string,
  placeholder: string,
  maxLength: number,
  label: string
): string {
  return (
    `<label class="sr-only" for="${id}">${escapeHtml(label)}</label>` +
    `<textarea class="build-field ${className}" id="${id}" rows="1" ` +
    `maxlength="${maxLength}" placeholder="${escapeHtml(placeholder)}">` +
    `${escapeHtml(value)}</textarea>`
  );
}

/**
 * What the briefing amounts to so far.
 *
 * Separate from the masthead because it is the one part of it that changes while somebody is typing: writing a note moves the count of stories without one.
 * Redrawing the masthead to keep that honest would take the caret with it, so the page repaints this paragraph alone.
 */
export function factsMarkup(state: BuilderState): string {
  const unwritten = unwrittenCount(state);
  const minutes = state.items.reduce(
    (total, item) =>
      total + (readingTimeMinutes(item.story.wordCount, item.story.tone) ?? 0),
    0
  );

  return [
    `<span>${state.status === "published" ? "Filed" : "Draft"}</span>`,
    `<span class="quiet">${storyCount(state.items.length)}</span>`,
    `<span class="quiet">${minutes} min read</span>`,
    // Only when there is one.
    // A standing "0 without a note" would be noise on a finished briefing, and this is the one thing the galley cannot show at a glance once the page is longer than the screen.
    unwritten > 0
      ? `<span class="build-unwritten">${unwritten} without a note</span>`
      : "",
  ].join("");
}

/** The title, the intro, and what the briefing amounts to so far. */
export function mastheadMarkup(state: BuilderState): string {
  return (
    // The page's heading, and an h1 the outline needs: the briefing's own title is a field being edited here rather than a heading, so it cannot be one.
    // Story headlines below are h2, which makes the outline h1 then h2.
    `<h1 class="build-kicker m"><span class="build-mark"></span> ${COPY.kicker}</h1>` +
    field(
      "build-title",
      "build-title-field",
      state.title,
      COPY.titlePlaceholder,
      TITLE_MAX,
      "Briefing title"
    ) +
    field(
      "build-intro",
      "build-intro-field",
      state.intro,
      COPY.introPlaceholder,
      INTRO_MAX,
      "Introduction"
    ) +
    `<p class="facts m build-facts" id="build-facts">${factsMarkup(state)}</p>`
  );
}

/**
 * One story: what you wrote about it, then the story itself, drawn small.
 *
 * The note is set larger and lighter than the Guardian headline underneath, which is the same thing the reading view does and for the same reason - the note is the only original writing on the page.
 *
 * The three controls carry the story's headline as `sr-only` text after their visible label.
 * Five buttons all called "Move up" are indistinguishable to anyone listening, and an `aria-label` would have replaced the visible word rather than extending it, which is the trap the desk's Remove fell into.
 */
export function bandMarkup(
  item: BuilderItem,
  index: number,
  total: number,
  now: Date
): string {
  const image = storyImage(item.story);
  const named = `<span class="sr-only"> - ${escapeHtml(item.story.title)}</span>`;

  const tools =
    `<button type="button" class="m" data-move="up" data-item="${item.id}"` +
    `${index === 0 ? " disabled" : ""}>${COPY.moveUp}${named}</button>` +
    `<button type="button" class="m" data-move="down" data-item="${item.id}"` +
    `${index === total - 1 ? " disabled" : ""}>${COPY.moveDown}${named}</button>` +
    `<button type="button" class="m" data-remove="${item.id}">` +
    `${COPY.remove}${named}</button>`;

  return (
    `<section class="build-band" data-band="${item.id}">` +
    `<div class="build-band-head">` +
    `<p class="build-pos m"><span>${positionLabel(index)}</span>` +
    (index === 0 ? `<span class="build-lede">- ${COPY.lede}</span>` : "") +
    `</p>` +
    `<div class="build-tools">${tools}</div>` +
    `</div>` +
    field(
      `note-${item.id}`,
      "build-note-field",
      item.note,
      COPY.notePlaceholder,
      NOTE_MAX,
      `Your note on ${item.story.title}`
    ) +
    `<p class="m build-count" data-count="${item.id}" aria-hidden="true"></p>` +
    `<div class="build-story">` +
    (image
      ? `<img class="build-thumb" src="${escapeHtml(image)}" alt="" loading="lazy" />`
      : `<span class="build-thumb"></span>`) +
    `<div>` +
    `<h2 class="build-headline">${escapeHtml(item.story.title)}</h2>` +
    `<div class="facts m">${factsLine(item.story, item.story.section, now)}</div>` +
    `</div>` +
    `</div>` +
    `</section>`
  );
}

/** The invitation, which names where the stories come from because at this moment that is the only thing worth saying. */
export function emptyMarkup(): string {
  return (
    `<div class="build-empty">` +
    `<h2 class="build-empty-heading">${COPY.emptyHeading}</h2>` +
    `<p class="build-empty-body">${COPY.emptyBody}</p>` +
    `<button type="button" class="btn btn-blue m" data-add>${COPY.addStories}</button>` +
    `</div>`
  );
}

export function addMarkup(roomLeft: number): string {
  return roomLeft === 0
    ? `<p class="build-add m quiet">${COPY.full}</p>`
    : `<button type="button" class="build-add m" data-add>+ ${COPY.addStories}</button>`;
}

/**
 * The bar, and the one place the briefing's state is acted on.
 *
 * The File button is never disabled. A greyed-out control makes a curator guess which of two rules they have broken, and WCAG exempts a disabled control from contrast, so the explanation would be the dimmest thing on the bar.
 * The requirement is stated beside it instead, and the server stays the authority on whether it is met.
 */
export function barMarkup(state: BuilderState, saveStatus: SaveStatus): string {
  const refusal = fileRefusal(state);
  const filed = state.status === "published";

  const action = filed
    ? `<a class="btn btn-blue m" href="/b/${encodeURIComponent(state.slug)}">${COPY.view}</a>` +
      // Two spellings of one control, swapped by width rather than shortened for everybody.
      // The bar is fixed-height furniture and the long form wraps mid-phrase at 390, which is the thing the rule forbids.
      // Only one is ever in the document, so the accessible name follows what is drawn instead of reading both out.
      `<button type="button" class="m build-withdraw" data-withdraw>` +
      `<span class="build-withdraw-long">${COPY.withdraw}</span>` +
      `<span class="build-withdraw-short">${COPY.withdrawShort}</span>` +
      `</button>`
    : `<button type="button" class="btn btn-blue m" data-file>${COPY.file}</button>`;

  return (
    // The save state changes without anything being navigated or clicked, so it has to announce itself.
    // Polite, because it must not interrupt typing.
    //
    // Drawn with its word rather than left empty for the page to fill in:
    //  an empty node that every caller had to remember to repaint is a blank save state one forgotten call away.
    `<p class="m build-save" id="build-save" data-state="${saveStatus}" role="status" aria-live="polite">` +
    `${SAVE_WORD[saveStatus]}</p>` +
    `<div class="build-bar-actions">` +
    (refusal && !filed
      ? `<p class="m quiet build-blocked">${escapeHtml(refusal)}</p>`
      : "") +
    action +
    // One live region for whatever the server refused, rewritten rather than appended to.
    // Appending stacked a paragraph per failure into a bar whose whole point is that it is a fixed height.
    `<p class="m build-blocked" id="build-error" role="status" aria-live="polite"></p>` +
    `</div>`
  );
}

/**
 * Deleting, which takes two presses.
 *
 * A browser `confirm()` blocks the page, cannot be styled, and reads badly, so the control arms itself instead.
 * Here rather than in the page because it is the one irreversible thing in the product and it was the only markup on this screen no test could see.
 */
export function dangerMarkup(arming: boolean): string {
  return (
    `<div class="build-danger">` +
    `<button type="button" class="m quiet" data-delete>` +
    `${arming ? COPY.deleteConfirm : COPY.delete}</button>` +
    (arming
      ? `<button type="button" class="m" data-delete-cancel>${COPY.deleteCancel}</button>`
      : "") +
    `</div>`
  );
}

/** Could not ask, which is a different page from an empty desk and says so. */
export function errorMarkup(message: string): string {
  return `<p class="build-error">${escapeHtml(message)}</p>`;
}

/**
 * Starting one, which needs a title before anything exists.
 *
 * Not a placeholder title the curator renames later, and this is the one place that matters most: **the slug is cut from the title at creation and never changes again.**
 * A briefing started as "Untitled" would live at `/b/untitled-3f9a` for ever, however it was eventually titled, and the address is the thing people share.
 */
export function starterMarkup(): string {
  return (
    `<div class="build-starter">` +
    // The page's heading, and an h1 the outline needs:
    //  the briefing's own title is a field being edited here rather than a heading, so it cannot be one.
    // Story headlines below are h2, which makes the outline h1 then h2.
    `<h1 class="build-kicker m"><span class="build-mark"></span> ${COPY.kicker}</h1>` +
    field(
      "starter-title",
      "build-title-field",
      "",
      COPY.titlePlaceholder,
      TITLE_MAX,
      "Briefing title"
    ) +
    `<p class="build-starter-note">The address it is published at is cut from this title and does not change afterwards, so it is worth writing the real one now.</p>` +
    `<button type="button" class="btn btn-blue m" data-start>Start it</button>` +
    // Empty and always present: a live region has to be in the document before its content changes, or the first thing it says is announced to nobody.
    `<p class="m build-starter-error" id="starter-error" role="status" aria-live="polite"></p>` +
    `</div>`
  );
}

/** What you have already written, most recently worked on first. */
export function shelfMarkup(briefings: readonly BriefingSummary[]): string {
  if (briefings.length === 0) return "";

  const rows = briefings
    .map(
      (briefing) =>
        `<li><a class="build-shelf-row" href="/build.html?b=${encodeURIComponent(briefing.slug)}">` +
        `<span class="build-shelf-title">${escapeHtml(briefing.title)}</span>` +
        `<span class="m build-shelf-facts">` +
        // Draft or filed is a word, never a colour alone.
        `<span>${briefing.status === "published" ? "Filed" : "Draft"}</span>` +
        `<span class="quiet">${storyCount(briefing.itemCount)}</span>` +
        `</span></a></li>`
    )
    .join("");

  return (
    `<section class="build-shelf">` +
    `<h2 class="build-shelf-heading m">Your briefings</h2>` +
    `<ul class="build-shelf-list">${rows}</ul>` +
    `</section>`
  );
}
