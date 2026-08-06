import "../styles/app.css";
import { getWire } from "../lib/api";
import { isLoggedIn, updateNavigation } from "../lib/auth";
import { mountBrowse, showWireError } from "../wire/browse";
import { mountDeck, showDeckError, startDateline } from "../wire/deck-view";
import { mountSpine } from "../wire/spine";
import { createStore } from "../wire/store";
import {
  fetchAccountDecisions,
  migrateSessionToAccount,
  migrationPending,
  mountDeskSync,
} from "../wire/sync";
import { mountToast } from "../wire/toast";
import { mountTray } from "../wire/tray";
import type { WireResponse } from "../wire/types";

function showError(): void {
  showDeckError();
  showWireError();
}

async function loadWire(): Promise<void> {
  const signedIn = isLoggedIn();

  // A session left unmerged by a failed attempt at sign-in is folded in before
  // the desk is read, or the read would come back without it and the store
  // would then replace the session with that answer.
  if (signedIn && migrationPending()) {
    await migrateSessionToAccount();
  }

  // Both reads at once. They do not depend on each other, and run one after
  // the other the reader waits for the sum rather than the longer of the two -
  // on a page whose whole job is to show a story immediately.
  const [response, accountDecisions] = await Promise.all([
    getWire() as Promise<WireResponse>,
    signedIn ? fetchAccountDecisions() : Promise.resolve(null),
  ]);

  // A failed request is not an empty wire. Neither surface may tell the reader
  // the newsroom is quiet when the truth is that we could not ask.
  if (!response.success) {
    showError();
    return;
  }

  // One store, six subscribers. The deck, the toast, the list, the tray and
  // the spine all read it, and only the store writes it - which is what stops
  // two surfaces disagreeing about what the reader has done. The sixth is the
  // sync, which watches rather than draws.
  const store = createStore(response.stories ?? [], accountDecisions);

  // The sync only runs when we know what the desk actually holds.
  //
  // Null means the read failed, which is not an empty desk - but the store has
  // no choice except to fall back to this tab's session, and in a fresh tab
  // that is empty. So the deck deals stories the reader has already triaged,
  // and with the sync mounted, re-deciding one of them would overwrite the
  // real decision on their account. Writing nothing is the only safe answer to
  // not knowing.
  if (signedIn && accountDecisions) {
    mountDeskSync(store);
  } else if (signedIn) {
    console.error("The desk could not be read; this session will not be saved");
  }

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
