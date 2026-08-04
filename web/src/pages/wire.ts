import "../styles/app.css";
import { getWire } from "../lib/api";
import { updateNavigation } from "../lib/auth";
import { mountBrowse, showWireError } from "../wire/browse";
import { mountDeck, showDeckError, startDateline } from "../wire/deck-view";
import { mountSpine } from "../wire/spine";
import { createStore } from "../wire/store";
import { mountToast } from "../wire/toast";
import { mountTray } from "../wire/tray";
import type { WireResponse } from "../wire/types";

function showError(): void {
  showDeckError();
  showWireError();
}

async function loadWire(): Promise<void> {
  const response = (await getWire()) as WireResponse;

  // A failed request is not an empty wire. Neither surface may tell the reader
  // the newsroom is quiet when the truth is that we could not ask.
  if (!response.success) {
    showError();
    return;
  }

  // One store, five subscribers. The deck, the toast, the list, the tray and
  // the spine all read it, and only the store writes it - which is what stops
  // two surfaces disagreeing about what the reader has done.
  const store = createStore(response.stories ?? []);

  mountDeck(store);
  mountToast(store);
  mountBrowse(store, {
    stale: response.stale,
    fetchedAt: response.fetchedAt,
  });
  mountTray(store);
  mountSpine(store);
}

function initWire(): void {
  updateNavigation();
  startDateline();

  // `getWire` swallows a failed fetch, so this only fires if rendering or
  // mounting throws. Without it the page sits on "Loading the wire..." for
  // ever with nothing but an unhandled rejection to show for it.
  loadWire().catch((error) => {
    console.error("The wire could not be loaded", error);
    showError();
  });
}

document.addEventListener("DOMContentLoaded", initWire);
