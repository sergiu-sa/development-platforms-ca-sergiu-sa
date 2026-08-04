/**
 * Everything on the wire, as a browsable list under the deck.
 *
 * The list and the deck share one store and one set of decisions. This module
 * owns only what the deck has no opinion about - which pillar is showing, in
 * what order, and whether decided stories are still on screen - and that state
 * is deliberately not persisted: it is what the reader is looking at now, not
 * something they should find waiting for them tomorrow.
 *
 * Two ways of updating, and the difference is load-bearing:
 *
 * - A decision normally only changes how a row *looks*, so the attributes and
 *   the labels are painted onto the rows already on screen. Redrawing twenty
 *   rows on every keypress would drop the focus of anyone who had tabbed into
 *   one, which is the bug this phase was most likely to ship.
 * - A decision changes which rows *exist* when hide-decided is on, and so does
 *   every change of filter or sort. Those redraw, and then put focus somewhere
 *   real, because the element the reader was standing on has gone.
 */

import { escapeHtml } from "../lib/html";
import { relativeTime } from "../lib/time";
import {
  BROWSE_BLANK_ALL,
  BROWSE_BLANK_FILTERED,
  BROWSE_BLANK_HEADING,
  BROWSE_RESET,
  WIRE_QUIET_HEADING,
  WIRE_QUIET_LINE,
  WIRE_QUIET_NOTE,
  WIRE_UNAVAILABLE_HEADING,
  WIRE_UNAVAILABLE_LINE,
} from "./copy";
import { currentStory, decisionFor, type DeckState } from "./deck";
import { BUTTON_FACES, faceClass, renderRow, stateLabel } from "./row";
import type { DeckStore } from "./store";
import { slugIndex } from "../lib/slug";
import type { Decision } from "./types";
import {
  DEFAULT_VIEW,
  pillarsOf,
  visibleStories,
  type ViewState,
} from "./view";

export interface WireMeta {
  stale: boolean;
  fetchedAt?: string | null;
}

const EVERYTHING = "Everything";

function chipMarkup(label: string, value: string, pressed: boolean): string {
  return (
    `<button class="chip m" type="button" data-pillar="${escapeHtml(value)}" ` +
    `aria-pressed="${pressed}">${escapeHtml(label)}</button>`
  );
}

/**
 * The one panel this surface draws when it has no rows to show, in all three
 * of the different things that can mean. Same shape every time - a heading, a
 * line, and whatever follows - so only the words change.
 */
function panel(heading: string, line: string, tail = ""): string {
  return (
    `<div class="blank">` +
    `<h3 class="blank-h">${heading}</h3>` +
    `<p class="blank-line">${line}</p>` +
    tail +
    `</div>`
  );
}

/**
 * The blank view, which is not the same thing as an empty wire.
 *
 * There are stories; this reader has filtered them all away. So it says which
 * filter did it and offers the way back, rather than reporting a quiet
 * newsroom that is not quiet.
 */
function blankMarkup(view: ViewState): string {
  return panel(
    BROWSE_BLANK_HEADING,
    view.pillar === null
      ? BROWSE_BLANK_ALL
      : BROWSE_BLANK_FILTERED(escapeHtml(view.pillar)),
    `<button class="btn m" type="button" data-act="reset">${BROWSE_RESET}</button>`
  );
}

function quietMarkup(): string {
  return panel(
    WIRE_QUIET_HEADING,
    WIRE_QUIET_LINE,
    `<p class="note quiet">${WIRE_QUIET_NOTE}</p>`
  );
}

function unavailableMarkup(): string {
  return panel(WIRE_UNAVAILABLE_HEADING, WIRE_UNAVAILABLE_LINE);
}

/**
 * Draws the list's failure state.
 *
 * A failed request is not an empty wire, and the controls are hidden with it:
 * filtering nothing by pillar is a set of dead buttons.
 */
export function showWireError(): void {
  const container = document.getElementById("wire-container");
  const controls = document.getElementById("browse-controls");
  const stale = document.getElementById("wire-stale");

  if (container) container.innerHTML = unavailableMarkup();
  if (controls) controls.hidden = true;
  if (stale) stale.hidden = true;
}

export function mountBrowse(store: DeckStore, meta: WireMeta): void {
  const container = document.getElementById("wire-container");
  const controls = document.getElementById("browse-controls");
  if (!container) return;

  const stories = store.get().stories;
  let view: ViewState = { ...DEFAULT_VIEW };

  // The slug is in the accessible name of both decision buttons, and the
  // repaint rewrites those without redrawing the row, so it needs the slug
  // without having the story to hand.
  const slugById = slugIndex(stories);

  // Staleness is a quiet timestamp, never an error banner. Old news reads
  // fine, so the stories render exactly as normal above it.
  const staleNote = document.getElementById("wire-stale");
  if (staleNote) {
    if (meta.stale && meta.fetchedAt) {
      staleNote.innerHTML =
        `<span class="quiet">Last updated ` +
        `${escapeHtml(relativeTime(meta.fetchedAt))}.</span> ` +
        `<span class="quiet">Showing the last stories we have.</span>`;
      staleNote.hidden = false;
    } else {
      staleNote.hidden = true;
    }
  }

  const renderControls = (): void => {
    if (!controls) return;

    // Nothing to filter. Left visible it is an empty bar holding its own
    // padding open above the "wire is quiet" panel.
    if (stories.length === 0) {
      controls.hidden = true;
      return;
    }

    const chips = [
      chipMarkup(EVERYTHING, "", view.pillar === null),
      ...pillarsOf(stories).map((pillar) =>
        chipMarkup(pillar, pillar, view.pillar === pillar)
      ),
    ].join("");

    controls.innerHTML =
      `<span class="m quiet controls-label">Filter</span>` +
      chips +
      `<span class="controls-gap"></span>` +
      `<button class="chip m" type="button" id="browse-sort" ` +
      `aria-pressed="${view.sort === "pillar"}">Sort: ` +
      `${view.sort === "pillar" ? "pillar" : "newest"}</button>` +
      `<button class="chip m" type="button" id="browse-hide" ` +
      `aria-pressed="${view.hideDecided}">Hide decided</button>`;
  };

  /**
   * Rebuilds the list. `keepFocus` is the id of a story whose row is about to
   * be replaced or removed, so the reader is put somewhere sensible instead of
   * being dropped on <body>.
   */
  const renderRows = (state: DeckState, keepFocus?: number): void => {
    if (stories.length === 0) {
      container.innerHTML = quietMarkup();
      return;
    }

    const shown = visibleStories(stories, state.decisions, view);
    const onDeckId = currentStory(state)?.id ?? null;

    if (shown.length === 0) {
      container.innerHTML = blankMarkup(view);
      container
        .querySelector<HTMLElement>("[data-act='reset']")
        ?.focus({ preventScroll: true });
      return;
    }

    container.innerHTML =
      `<div class="rows">` +
      shown
        .map((story) =>
          renderRow(story, {
            decision: decisionFor(state, story.id),
            onDeck: story.id === onDeckId,
          })
        )
        .join("") +
      `</div>`;

    if (keepFocus === undefined) return;

    // The row that had focus may still be here (a filter change) or gone (a
    // decision while hide-decided is on). Prefer the same row, then the row
    // that took its place, then the controls.
    const landing =
      container.querySelector<HTMLElement>(
        `.row[data-story-id="${keepFocus}"] .mini`
      ) ??
      container.querySelector<HTMLElement>(".row .mini") ??
      document.getElementById("browse-hide");

    landing?.focus({ preventScroll: true });
  };

  /**
   * Paints decisions onto rows that are already on screen: the attribute the
   * blue edge and the strike-through hang off, and the word beside it, because
   * colour is never the only signal.
   */
  const paint = (state: DeckState): void => {
    const onDeckId = currentStory(state)?.id ?? null;

    for (const row of container.querySelectorAll<HTMLElement>(
      "[data-story-id]"
    )) {
      const id = Number(row.dataset.storyId);
      const decision = decisionFor(state, id);
      const label = row.querySelector(".row-state");

      if (decision) row.dataset.state = decision;
      else delete row.dataset.state;

      // The same four words the row is drawn with, from the same function.
      if (label) {
        label.textContent = stateLabel({ decision, onDeck: id === onDeckId });
      }

      // The buttons say what pressing them will do, so they change with the
      // decision even though the row itself is not redrawn.
      repaintActions(row, decision, slugById.get(id) ?? "");
    }
  };

  const focusedStoryId = (): number | undefined => {
    const row = (
      document.activeElement as HTMLElement | null
    )?.closest<HTMLElement>(".row");
    return row ? Number(row.dataset.storyId) : undefined;
  };

  const changeView = (next: Partial<ViewState>): void => {
    view = { ...view, ...next };
    renderControls();
    renderRows(store.get(), focusedStoryId());
  };

  renderControls();

  let painted = false;
  store.subscribe((state) => {
    // Hide-decided is the one setting where a decision changes which rows
    // exist rather than how they look, so it is the one that has to redraw.
    if (!painted || view.hideDecided) {
      renderRows(state, painted ? focusedStoryId() : undefined);
      painted = true;
      return;
    }

    paint(state);
  });

  container.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>("[data-act]");
    if (!button) return;

    const act = button.dataset.act;

    if (act === "reset") {
      changeView({ pillar: null, hideDecided: false });
      return;
    }

    const id = Number(button.closest<HTMLElement>(".row")?.dataset.storyId);
    if (!Number.isInteger(id)) return;

    if (act === "save") store.decide(id, "saved");
    else if (act === "skip") store.decide(id, "skipped");
    else if (act === "clear") store.clear(id);
  });

  controls?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>("button");
    if (!button) return;

    if (button.id === "browse-sort") {
      changeView({ sort: view.sort === "pillar" ? "newest" : "pillar" });
      document.getElementById("browse-sort")?.focus({ preventScroll: true });
      return;
    }

    if (button.id === "browse-hide") {
      changeView({ hideDecided: !view.hideDecided });
      document.getElementById("browse-hide")?.focus({ preventScroll: true });
      return;
    }

    if (button.dataset.pillar !== undefined) {
      changeView({ pillar: button.dataset.pillar || null });
    }
  });
}

/**
 * Swaps a row's two decision buttons for the verbs that now apply, in place.
 *
 * Written against the live nodes rather than by re-rendering the row, so a
 * reader sitting on the button they just pressed keeps their place. The faces
 * come from the same table `row.ts` builds the markup from, so a repainted
 * button and a freshly drawn one cannot say different things.
 */
function repaintActions(
  row: HTMLElement,
  decision: Decision | null,
  slug: string
): void {
  for (const button of row.querySelectorAll<HTMLElement>(
    ".row-acts button[data-slot]"
  )) {
    const slot = button.dataset.slot;
    if (slot !== "save" && slot !== "skip") continue;

    const active = decision === (slot === "save" ? "saved" : "skipped");
    const face = BUTTON_FACES[slot][active ? "on" : "off"];

    button.dataset.act = face.act;
    button.textContent = face.label;
    button.setAttribute("aria-label", face.aria(slug));
    // The same function the markup path uses, so a new or renamed tint cannot
    // mean one thing when a row is drawn and another when it is repainted.
    button.className = faceClass(face);
  }
}
