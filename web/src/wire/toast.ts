/**
 * The undo toast, and the page's only live region.
 *
 * It does two jobs on purpose. The deck changes its card without navigating,
 * so a screen reader has to be told; and `Z` needs a label on screen, because
 * a keyboard action nobody can see is not an accessible one. Announcing from
 * the toast rather than from a second hidden region means each decision is
 * spoken exactly once.
 *
 * A subscriber in its own right rather than something the deck view calls, so
 * a decision made anywhere reaches it. Phase 4's browse row gets the toast for
 * free.
 */

import { decisionLabel } from "./copy";
import {
  counts,
  cursor,
  dealtCount,
  deckStatus,
  undealt,
  type DeckState,
  type LastAction,
} from "./deck";
import type { DeckStore } from "./store";
import { storySlug } from "../lib/slug";

const TOAST_MS = 6000;

/** What is on deck now, said in full - the visible toast is only a summary. */
function nowShowing(state: DeckState): string {
  switch (deckStatus(state)) {
    case "dealing": {
      const at = cursor(state)!;
      return `Now showing story ${at + 1} of ${dealtCount(state)}: ${state.stories[at].title}.`;
    }
    case "batch-done":
      return `That is ${dealtCount(state)}. ${undealt(state)} more on the wire.`;
    case "exhausted":
      return `You have seen every story on the wire. ${counts(state).saved} saved.`;
    default:
      return "";
  }
}

export function mountToast(store: DeckStore): void {
  const toast = document.getElementById("deck-toast");
  const text = document.getElementById("toast-text");
  const undoButton = document.getElementById("deck-undo");
  const announcer = document.getElementById("deck-announcer");
  if (!toast || !text || !undoButton) return;

  let shown: LastAction | null = store.get().lastAction;
  // Seeded so the first subscribe call, which fires on mount, does not
  // announce a card the reader has not done anything to yet.
  let announcedShowing = nowShowing(store.get());
  let timer = 0;

  const hide = (): void => {
    window.clearTimeout(timer);
    if (toast.hidden) return;

    // Undo lives inside the toast, and hiding a subtree that holds focus
    // drops it to <body>. Hand focus back to the deck rather than losing it.
    const hadFocus = toast.contains(document.activeElement);
    toast.hidden = true;
    if (hadFocus) document.getElementById("deck-skip")?.focus();
  };

  const scheduleHide = (): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Never pull a control out from under someone who is sitting on it.
      if (toast.contains(document.activeElement)) scheduleHide();
      else hide();
    }, TOAST_MS);
  };

  store.subscribe((state) => {
    const action = state.lastAction;
    const showing = nowShowing(state);

    if (action !== shown) {
      if (!action) {
        // The only way back to null is an undo, and it deserves saying: the
        // message that was there a moment ago would otherwise just vanish.
        if (shown && announcer) announcer.textContent = `Undone. ${showing}`;
        shown = null;
        announcedShowing = showing;
        hide();
        return;
      }

      const story = state.stories.find((s) => s.id === action.storyId);
      if (!story) return;

      shown = action;

      const slug = storySlug(story.section, story.id);
      const verb = decisionLabel(action.to);

      text.textContent = `${verb} ${slug}`;
      undoButton.setAttribute(
        "aria-label",
        `Undo, putting back ${slug} (keyboard shortcut Z)`
      );
      toast.hidden = false;

      if (announcer) announcer.textContent = `${verb} ${slug}. ${showing}`;
      announcedShowing = showing;

      scheduleHide();
      return;
    }

    // No new decision, but the deck moved anyway. Dealing the next batch
    // swaps a panel for a card without touching lastAction, and nothing else
    // on the page would tell a screen reader that the screen just changed.
    if (showing !== announcedShowing) {
      if (announcer) announcer.textContent = showing;
      announcedShowing = showing;
    }
  });

  undoButton.addEventListener("click", () => store.undo());
}
