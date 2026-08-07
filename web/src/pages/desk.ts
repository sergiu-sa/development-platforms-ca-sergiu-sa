import "../styles/app.css";
import { getDesk, getDeskEdition, safeNext } from "../lib/api";
import { isLoggedIn, updateNavigation } from "../lib/auth";
import {
  mountBrokenImageGuard,
  mountRemove,
  renderArchive,
  renderEdition,
  renderMasthead,
  showDeskError,
} from "../desk/desk-view";
import {
  composeArchive,
  dayBounds,
  dayFromQuery,
  editionFacts,
} from "../desk/edition";
import type { DeskDecision, DeskEntry } from "../desk/types";

interface EditionResponse {
  success: boolean;
  entries?: DeskEntry[];
}

interface ArchiveResponse {
  success: boolean;
  entries?: DeskDecision[];
}

async function loadDesk(): Promise<void> {
  // Client-side only, and the API is the real boundary: /api/desk answers 401 to an unauthenticated request whatever this page does.
  // This is here so a signed-out visitor gets the sign-in form instead of an error.
  //
  // The whole path is carried across, not just "/desk.html", so a shared link to a dated edition survives signing in.
  // `handleExpiredSession` already does it this way and `safeNext` already accepts a query string.
  if (!isLoggedIn()) {
    const here = safeNext(window.location.pathname + window.location.search);
    window.location.href = `/login.html?next=${encodeURIComponent(here)}`;
    return;
  }

  const dateEl = document.getElementById("edition-date");
  const factsEl = document.getElementById("edition-facts");
  const editionEl = document.getElementById("edition");
  const archiveEl = document.getElementById("archive");
  const stripEl = document.getElementById("archive-strip");
  if (!dateEl || !factsEl || !editionEl || !archiveEl || !stripEl) return;

  const day = dayFromQuery(window.location.search);
  const { from, to } = dayBounds(day);

  // Both reads at once. The edition is one day and the archive is every day,
  // so neither depends on the other.
  const [edition, archive] = await Promise.all([
    getDeskEdition(from, to) as Promise<EditionResponse>,
    getDesk("saved") as Promise<ArchiveResponse>,
  ]);

  // A failed request is not an empty desk.
  // "We could not ask" and "you keptnothing" must not look the same;
  // the same rule the homepage follows for a failed wire.
  // Drawn after the archive so a reader whose day would not load still has the way to one that will.
  const decisions = archive.success ? (archive.entries ?? []) : [];
  const drawArchive = (): void =>
    renderArchive(archiveEl, stripEl, composeArchive(decisions), day);

  drawArchive();

  if (!edition.success) {
    showDeskError(editionEl);
    return;
  }

  // What is still on the desk for this day.
  // Held here because it is the only honest answer to "what does the page show now":
  // a removal changes the lead, the sections, both masthead numbers and the archive count, and every attempt to adjust those four in place left one of them behind.
  // Redrawing from the remaining entries is one code path instead of four, and a day's worth of stories is a handful of kilobytes.
  let remaining = edition.entries ?? [];

  const draw = (): void => {
    renderMasthead(dateEl, factsEl, editionFacts(remaining), day);
    renderEdition(editionEl, remaining);
    mountBrokenImageGuard(editionEl);
  };

  draw();

  mountRemove(editionEl, (storyId) => {
    remaining = remaining.filter((entry) => entry.storyId !== storyId);

    // The strip counts saves per day, so the day on screen has one fewer.
    const index = decisions.findIndex(
      (decision) => decision.storyId === storyId
    );
    if (index !== -1) decisions.splice(index, 1);

    draw();
    drawArchive();
  });
}

function initDesk(): void {
  updateNavigation();

  loadDesk().catch((error) => {
    console.error("The desk could not be loaded", error);
    const editionEl = document.getElementById("edition");
    if (editionEl) showDeskError(editionEl);
  });
}

document.addEventListener("DOMContentLoaded", initDesk);
