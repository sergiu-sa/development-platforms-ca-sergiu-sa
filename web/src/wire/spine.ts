/**
 * The sticky header that takes over once the deck has scrolled away.
 *
 * Its whole job is that the reader is never lost: the saved count is never
 * off-screen, and the way back to the deck is always one press. It is
 * `position: sticky` after a `100dvh` deck, so it appears exactly when the
 * deck stops being visible without anything having to watch the scroll.
 *
 * The design calls for a desk link here too. `/desk` is phase 7, and the same
 * rule applies as in the tray: no link that goes nowhere.
 */

import { counts } from "./deck";
import { focusDeck } from "./deck-view";
import type { DeckStore } from "./store";

export function mountSpine(store: DeckStore): void {
  const spine = document.getElementById("spine");
  const count = document.getElementById("spine-count");
  const back = document.getElementById("spine-deck");
  if (!spine || !count) return;

  if (back) {
    // Both lengths are aria-hidden and the button carries one constant label,
    // so a screen reader hears "Back to the deck" at every width rather than
    // hearing it twice at one of them. Same shape as the deck's own bar.
    back.setAttribute("aria-label", "Back to the deck");
    back.innerHTML =
      `<span aria-hidden="true">&uarr;</span>` +
      `<span class="long" aria-hidden="true">Back to the deck</span>` +
      `<span class="short" aria-hidden="true">Deck</span>`;
    back.addEventListener("click", () => {
      // The stylesheet's `scroll-behavior: auto` under prefers-reduced-motion
      // does not reach this. An explicit `behavior` passed to scrollTo wins
      // over the computed property, so the choice has to be made here or the
      // page animates for a reader who asked it not to. The jump still
      // happens either way - only the easing goes.
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      // The deck's first control, not just the top of the document: a reader
      // sent back to the deck should be able to carry on deciding without
      // reaching for the mouse again. Through the deck's own helper, because
      // the id belongs to that module.
      focusDeck();
    });
  }

  // Built once. Only two numbers change, so re-parsing five spans on every
  // decision - including the ones that cannot move them - is work for nothing.
  //
  // Three spans rather than one string, so the narrow bar can drop the wire
  // total without wrapping or truncating anything. It is the one part that is
  // genuinely redundant, since the deck's own Browse control carries it, and a
  // fixed-height bar has to shorten its labels rather than grow.
  count.innerHTML =
    `<span class="spine-total">${store.get().stories.length} on the wire</span>` +
    `<span class="spine-sep"> · </span>` +
    `<span class="spine-saved"></span>` +
    `<span class="spine-sep"> · </span>` +
    `<span class="spine-skipped"></span>`;

  const savedText = count.querySelector(".spine-saved");
  const skippedText = count.querySelector(".spine-skipped");

  store.subscribe((state) => {
    const { saved, skipped } = counts(state);
    if (savedText) savedText.textContent = `${saved} saved`;
    if (skippedText) skippedText.textContent = `${skipped} skipped`;
  });
}
