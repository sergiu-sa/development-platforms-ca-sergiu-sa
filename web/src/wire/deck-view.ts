/**
 * The deck's DOM layer. Subscribes to the store, draws whatever state it is
 * handed, and turns clicks and keys back into store calls. It holds no state
 * of its own beyond what it needs to animate.
 *
 * There is no animation lock. The roadmap warned that a 240ms lock loses a
 * fast typist's keypresses, so the decision is applied to the store and the
 * next card is drawn immediately; the card just decided is cloned and the
 * clone animates away on its own. Three quick presses give three decisions and
 * three clones, and none of them is dropped.
 */

import { renderCard } from "./card";
import {
  WIRE_QUIET_HEADING,
  WIRE_QUIET_LINE,
  WIRE_QUIET_NOTE,
  WIRE_UNAVAILABLE_HEADING,
  WIRE_UNAVAILABLE_LINE,
} from "./copy";
import {
  counts,
  currentStory,
  cursor,
  dealtCount,
  deckStatus,
  nextBatchSize,
  undealt,
  type DeckState,
  type DeckStatus,
} from "./deck";
import type { DeckStore } from "./store";
import type { Decision } from "./types";
import { escapeHtml } from "../lib/html";
import { storySlug } from "../lib/slug";

/** Long enough to outlast the 260ms flight, short enough to never be seen. */
const GHOST_TIMEOUT_MS = 600;

function panel(inner: string): string {
  return `<div class="deck-panel">${inner}</div>`;
}

/**
 * The batch is finished but the wire is not.
 *
 * Deliberately not `-30-`. That is the sign-off for the end of the wire, and
 * printing it with eight stories still to come would be the one piece of
 * newsroom language on the page that lies.
 */
/**
 * The wire's sign-off, and decoration only.
 *
 * Hidden from assistive technology: read aloud, "-30-" is noise. The spec is
 * explicit that it never carries meaning on its own, so the heading beside it
 * is what actually says the wire has run out.
 */
const THIRTY = `<p class="thirty" aria-hidden="true">-30-</p>`;

function batchDonePanel(state: DeckState): string {
  const next = nextBatchSize(state);

  return panel(
    `<h2 class="deck-panel-h">That's ${dealtCount(state)}.</h2>` +
      `<p class="deck-panel-line">${counts(state).saved} saved to your desk. ` +
      `${undealt(state)} more on the wire.</p>` +
      `<div class="deck-panel-acts">` +
      `<button class="btn btn-blue m" id="deck-more" type="button">` +
      `Next ${next} ${next === 1 ? "story" : "stories"}</button>` +
      `<a class="btn m" href="#browse">Browse everything</a>` +
      `</div>`
  );
}

function exhaustedPanel(state: DeckState): string {
  return panel(
    THIRTY +
      `<h2 class="deck-panel-h">That's the wire.</h2>` +
      `<p class="deck-panel-line">You have seen every story on it. ` +
      `${counts(state).saved} saved to your desk.</p>` +
      `<p class="note quiet">Saved stories stay readable after they leave ` +
      `the wire.</p>` +
      `<div class="deck-panel-acts">` +
      `<a class="btn m" href="#browse">Browse everything again</a>` +
      `</div>`
  );
}

/** An empty wire is not an error. It is a quiet newsroom. */
function emptyPanel(): string {
  return panel(
    THIRTY +
      `<h2 class="deck-panel-h">${WIRE_QUIET_HEADING}</h2>` +
      `<p class="deck-panel-line">${WIRE_QUIET_LINE}</p>` +
      `<p class="note quiet">${WIRE_QUIET_NOTE}</p>`
  );
}

function errorPanel(): string {
  return panel(
    `<h2 class="deck-panel-h">${WIRE_UNAVAILABLE_HEADING}</h2>` +
      `<p class="deck-panel-line">${WIRE_UNAVAILABLE_LINE}</p>`
  );
}

/**
 * Draws the deck's failure state.
 *
 * Exported so the page can compose modules rather than write markup into the
 * deck's own node - a failed request is a state of the deck, and `deck-slot`
 * should be an id only this module knows.
 */
export function showDeckError(): void {
  const slot = document.getElementById("deck-slot");
  const acts = document.getElementById("deck-acts");
  if (!slot) return;

  slot.innerHTML = errorPanel();
  if (acts) acts.hidden = true;
}

function stagePanel(state: DeckState, status: DeckStatus): string {
  switch (status) {
    case "batch-done":
      return batchDonePanel(state);
    case "exhausted":
      return exhaustedPanel(state);
    default:
      return emptyPanel();
  }
}

/**
 * The slugs threaded onto a rail's spindle.
 *
 * Carries `.m` rather than setting its own size: the prototype's rails were
 * 10px, under the binding floor, and taking the size from the furniture class
 * means the floor cannot be undercut here by accident.
 */
function slugColumn(state: DeckState, kind: Decision): string {
  return state.stories
    .filter((story) => state.decisions.get(story.id) === kind)
    .map(
      (story) =>
        `<span class="slug m">${escapeHtml(storySlug(story.section, story.id))}</span>`
    )
    .join("");
}

export function mountDeck(store: DeckStore): void {
  const slot = document.getElementById("deck-slot");
  const acts = document.getElementById("deck-acts");
  if (!slot || !acts) return;

  const gaugeBar = document.getElementById("gauge-bar");
  const position = document.getElementById("deck-position");
  const savedCount = document.getElementById("rail-save-n");
  const skippedCount = document.getElementById("rail-skip-n");
  const savedSlugs = document.getElementById("rail-save-slugs");
  const skippedSlugs = document.getElementById("rail-skip-slugs");

  // One MediaQueryList for the life of the page rather than one per decision.
  // Live, so a reader who changes the system setting is honoured without a
  // reload.
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The last action already animated, held by reference. Comparing by
  // reference is what stops a re-render for some other reason replaying the
  // flight that has already happened.
  let animated = store.get().lastAction;
  let firstRender = true;

  const flyOut = (ghost: HTMLElement, to: Decision): void => {
    // The clone inherits every class the live card had, `dealt` among them.
    // `.card.dealt` and `.card.go-*` are the same specificity and `dealt` is
    // declared last, so leaving it on wins the cascade and plays the entrance
    // animation on a card that is on its way out - it fades back in over the
    // new card instead of flying away.
    ghost.classList.remove("dealt");
    ghost.classList.add("leaving", to === "saved" ? "go-save" : "go-skip");
    // A snapshot on its way off screen: out of the accessibility tree, out of
    // the tab order, and unclickable.
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    slot.append(ghost);

    // animationend never fires if the animation does not start, so there is a
    // fallback - cancelled when the animation does end, so a burst of
    // decisions does not leave a burst of pending timers.
    const fallback = window.setTimeout(() => ghost.remove(), GHOST_TIMEOUT_MS);
    ghost.addEventListener(
      "animationend",
      () => {
        window.clearTimeout(fallback);
        ghost.remove();
      },
      { once: true }
    );
  };

  const renderStage = (state: DeckState, status: DeckStatus): void => {
    const story = currentStory(state);

    const flying =
      state.lastAction && state.lastAction !== animated
        ? state.lastAction
        : null;
    animated = state.lastAction;

    // Cloned before the slot is emptied, appended after, so it paints above
    // the card that replaced it.
    const outgoing = slot.querySelector<HTMLElement>(".card:not(.leaving)");
    const ghost =
      flying && outgoing && !motion.matches
        ? { node: outgoing.cloneNode(true) as HTMLElement, to: flying.to }
        : null;

    // Both halves of the stage can take focus away from the reader: the
    // decision bar disappears when the deck clears, and the slot's contents
    // are rebuilt on every render. Either way focus would fall to <body> and
    // a keyboard walk would restart at the top of the document.
    const active = document.activeElement;
    const focusWasInActs = acts.contains(active);
    const focusWasInSlot = active !== slot && slot.contains(active);

    // Keep any ghosts already in flight; replace everything else.
    for (const node of Array.from(slot.children)) {
      if (!node.classList.contains("leaving")) node.remove();
    }
    slot.insertAdjacentHTML(
      "afterbegin",
      story ? renderCard(story) : stagePanel(state, status)
    );

    if (ghost) flyOut(ghost.node, ghost.to);

    if (story && !firstRender && !motion.matches) {
      slot.querySelector(".card:not(.leaving)")?.classList.add("dealt");
    }

    acts.hidden = status !== "dealing";

    if (focusWasInActs || focusWasInSlot) {
      if (acts.hidden) {
        // The decision bar has gone; the panel that replaced it takes over.
        slot
          .querySelector<HTMLElement>(".deck-panel a, .deck-panel button")
          ?.focus();
      } else if (focusWasInSlot) {
        // A card or panel the reader was inside has been replaced by another
        // card. Undoing back out of the cleared state lands here.
        document.getElementById("deck-skip")?.focus();
      }
    }

    firstRender = false;
  };

  const renderGauge = (state: DeckState, at: number | null): void => {
    const dealt = dealtCount(state);

    if (gaugeBar) {
      gaugeBar.innerHTML = state.stories
        .slice(0, dealt)
        .map((story, i) => {
          if (state.decisions.has(story.id))
            return `<i class="tick decided"></i>`;
          return i === at ? `<i class="tick now"></i>` : `<i class="tick"></i>`;
        })
        .join("");
    }

    if (position) {
      position.textContent =
        dealt === 0 ? "" : at === null ? "all seen" : `${at + 1} of ${dealt}`;
    }
  };

  const renderRails = (state: DeckState): void => {
    const { saved, skipped } = counts(state);

    if (savedCount) savedCount.textContent = String(saved);
    if (skippedCount) skippedCount.textContent = String(skipped);
    if (savedSlugs) savedSlugs.innerHTML = slugColumn(state, "saved");
    if (skippedSlugs) skippedSlugs.innerHTML = slugColumn(state, "skipped");
  };

  // The wire's length is fixed for the store's lifetime, so this is written
  // once at mount rather than on every decision.
  const total = store.get().stories.length;
  const browseCount = document.getElementById("browse-count");
  if (browseCount) browseCount.textContent = String(total);
  document
    .getElementById("deck-browse")
    ?.setAttribute(
      "aria-label",
      `Browse all ${total} ${total === 1 ? "story" : "stories"} on the wire`
    );

  store.subscribe((state) => {
    // Derived once and passed down: cursor is a scan, and the stage, the gauge
    // and the status all want the same answer.
    const at = cursor(state);
    const status = deckStatus(state);

    renderStage(state, status);
    renderGauge(state, at);
    renderRails(state);
  });

  document.getElementById("deck-skip")?.addEventListener("click", () => {
    store.decideCurrent("skipped");
  });

  document.getElementById("deck-save")?.addEventListener("click", () => {
    store.decideCurrent("saved");
  });

  // The continuation button is drawn inside the slot, so it is caught here
  // rather than bound each time the panel is redrawn.
  slot.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("#deck-more")) return;

    store.dealMore();
    // The button that was clicked no longer exists.
    document.getElementById("deck-skip")?.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }

    // Auto-repeat fires at roughly 30Hz once the OS delay passes, so a key
    // held down for a second would decide the whole batch. Undo is single
    // step by design, so eleven of those twelve would be unrecoverable.
    if (event.repeat) return;

    const target = event.target as HTMLElement | null;
    if (
      target?.isContentEditable ||
      (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }

    const key = event.key.toLowerCase();

    if (key === "x" || event.key === "ArrowLeft")
      store.decideCurrent("skipped");
    else if (key === "s" || event.key === "ArrowRight")
      store.decideCurrent("saved");
    else if (key === "z") store.undo();
    else return;

    event.preventDefault();
  });
}

/**
 * The dateline: the date, the time and where the stories came from.
 *
 * The clock is the machine's own time, so it is kept honest rather than
 * printed once and left to drift. One formatter is built for the page rather
 * than one every thirty seconds.
 */
const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function startDateline(): void {
  const dateline = document.getElementById("dateline");
  if (!dateline) return;

  const paint = () => {
    const now = new Date();
    const date = DATE_FORMAT.format(now).replace(",", "").toUpperCase();

    dateline.textContent = `${date} · ${now.toTimeString().slice(0, 5)} · Guardian wire`;
  };

  paint();
  window.setInterval(paint, 30_000);
}
