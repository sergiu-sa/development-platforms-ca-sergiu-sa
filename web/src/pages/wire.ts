import "../styles/app.css";
import { getWire } from "../lib/api";
import { updateNavigation } from "../lib/auth";
import { mountDeck, showDeckError, startDateline } from "../wire/deck-view";
import { renderWire, syncDecisions } from "../wire/render";
import { createStore } from "../wire/store";
import { mountToast } from "../wire/toast";
import type { WireResponse } from "../wire/types";

async function loadWire(): Promise<void> {
  const container = document.getElementById("wire-container");
  if (!container) return;

  const response = (await getWire()) as WireResponse;

  renderWire(container, response);

  // A failed request is not an empty wire. The deck must not tell the reader
  // the newsroom is quiet when the truth is that we could not ask.
  if (!response.success) {
    showDeckError();
    return;
  }

  // One store, three subscribers. The deck, the toast and the list all read
  // it, and only the store writes it.
  const store = createStore(response.stories ?? []);

  mountDeck(store);
  mountToast(store);
  store.subscribe((state) => syncDecisions(container, state));
}

function initWire(): void {
  updateNavigation();
  startDateline();

  // `getWire` swallows a failed fetch, so this only fires if rendering or
  // mounting throws. Without it the page sits on "Loading the wire..." for
  // ever with nothing but an unhandled rejection to show for it.
  loadWire().catch((error) => {
    console.error("The wire could not be loaded", error);

    showDeckError();
    const container = document.getElementById("wire-container");
    if (container) {
      renderWire(container, { success: false, stale: false, stories: [] });
    }
  });
}

document.addEventListener("DOMContentLoaded", initWire);
