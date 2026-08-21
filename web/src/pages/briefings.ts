import "../styles/app.css";
import { getBriefings } from "../lib/api";
import { updateNavigation } from "../lib/auth";
import {
  briefingListMarkup,
  listErrorMarkup,
  noBriefingsMarkup,
  pastTheEndMarkup,
} from "../briefing/list";
import { hrefForPage, pageFromLocation, pagerMarkup } from "../briefing/pager";
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

  const page = pageFromLocation(window.location.search);
  const { status, body } = await getBriefings(page);

  // A failed read is not an empty shelf. "We could not ask" and "nobody has filed anything" must not look the same, which is the rule the desk learned.
  if (status !== 200 || !body?.success) {
    slot.innerHTML = listErrorMarkup();
    return;
  }

  const briefings: BriefingSummary[] = body.briefings ?? [];
  const pager = pagerMarkup(body.page, body.pageSize, body.total, (n) =>
    hrefForPage(window.location.pathname, n)
  );

  // An empty page is only an empty *shelf* when the shelf itself is empty.
  // `?page=9` against thirty filed briefings returns no rows and a total of thirty, and printing "Nothing filed yet" there tells a reader nobody has ever filed anything;
  //  the exact confusion this page's own comment above says must never happen, with no pager drawn to get back.
  if (briefings.length === 0 && body.total > 0) {
    slot.innerHTML = pastTheEndMarkup() + pager;
    return;
  }

  // The pager is shared with a curator's shelf, which is where it was written.
  // It draws nothing when one page holds everything, so this costs the common case nothing.
  slot.innerHTML = briefings.length
    ? briefingListMarkup(briefings) + pager
    : noBriefingsMarkup();
}

updateNavigation();
void loadBriefings();
