import "../styles/app.css";
import { getBriefings } from "../lib/api";
import { updateNavigation } from "../lib/auth";
import {
  briefingListMarkup,
  listErrorMarkup,
  noBriefingsMarkup,
} from "../briefing/list";
import type { BriefingSummary } from "../briefing/types";

/**
 * Every filed briefing, newest first.
 *
 * Public: the listing is published-only whoever asks, so this page needs no token and no sign-in guard.
 * It exists because nothing else in the product links to a briefing;
 * the builder and the curator's shelf are later phases, and without this the reading view was reachable only by knowing its address.
 */
async function loadBriefings(): Promise<void> {
  const slot = document.getElementById("briefings");
  if (!slot) return;

  const { status, body } = await getBriefings();

  // A failed read is not an empty shelf. "We could not ask" and "nobody has filed anything" must not look the same, which is the rule the desk learned.
  if (status !== 200 || !body?.success) {
    slot.innerHTML = listErrorMarkup();
    return;
  }

  const briefings: BriefingSummary[] = body.briefings ?? [];

  slot.innerHTML = briefings.length
    ? briefingListMarkup(briefings)
    : noBriefingsMarkup();
}

updateNavigation();
void loadBriefings();
