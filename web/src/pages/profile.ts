import "../styles/app.css";
import { getMyBriefings } from "../lib/api";
import { currentUsername, isLoggedIn, updateNavigation } from "../lib/auth";
import { loadShelf } from "../briefing/data";
import { hrefForPage, pageFromLocation } from "../briefing/pager";
import {
  DRAFTS_SLOT,
  draftsBandMarkup,
  noCuratorMarkup,
  shelfErrorMarkup,
  shelfMarkup,
} from "../briefing/profile";

/**
 * One curator's public shelf.
 *
 * Public, so there is no sign-in guard: the shelf is published-only whoever asks, and the page has to work for a visitor who followed a byline out of a briefing.
 * That is also why it must not adopt the guard `desk.ts` and `build.ts` carry - those pages are behind auth and this one is emphatically not.
 *
 * The only thing being signed in changes is the drafts band, which is additive and fails to nothing.
 *
 * Reading the shelf lives in `briefing/data.ts`, beside the reading view's, so this file stays what a page entry should be: which markup, in which order, on which answer.
 */

/**
 * The username this page is for.
 *
 * `/u/<name>` in production, where vercel.json rewrites the pretty path to the route that generates the document.
 * `?u=` is the development fallback, so u.html can be opened directly without the rewrite Vite does not have.
 *
 * **This regex is the third copy of the `/u/:username` mapping**, beside `vercel.json` and the Vite dev middleware. Three hooks, because the runtimes genuinely differ; `tests/pretty-paths.test.ts` is what stops the three drifting.
 */
function usernameFromLocation(): string {
  const fromPath = /^\/u\/([^/?#]+)/.exec(window.location.pathname);

  if (fromPath) {
    try {
      return decodeURIComponent(fromPath[1]);
    } catch {
      // `decodeURIComponent` throws URIError on a malformed escape, and `/u/%` is a legal thing to type.
      // Unguarded it threw inside `mount()`, which leaves the shell on screen saying "Loading this shelf..." for ever with nothing but an unhandled rejection in the console;
      //  the same failure shape as the builder's signed-out hang, which 746 green tests could not see.
      // An empty name falls through to "No curator by that name", which is the honest answer for an address that cannot name anybody.
      return "";
    }
  }

  return new URLSearchParams(window.location.search).get("u") ?? "";
}

/**
 * How many drafts the signed-in owner has, and zero for everybody else.
 *
 * Derived by subtraction rather than by counting rows.
 * `body.total` is every briefing this author has; `published` is the shelf's own total, already in hand and already painted. The difference is the drafts, and it needs no row payload at all.
 * Filtering the returned page for `status === "draft"` was the first version, and it was wrong past twenty briefings: `listOwn` pages at twenty, so a curator whose drafts sat on page two was told they had none.
 *
 * Deliberately best-effort. A failure means the band is not drawn, which is the right outcome: the shelf beside it is the page, and losing a private count is not worth turning a public page into an error.
 *
 * The name comparison decides what somebody is *shown* and never what they may do. The token it reads is decoded and not verified - the browser has no secret to verify it with - so the real check is the one `/api/desk/briefings` already made against the same token, server-side.
 */
async function ownDraftCount(
  username: string,
  published: number
): Promise<number> {
  if (!isLoggedIn()) return 0;

  const mine = currentUsername();
  if (!mine || mine.toLowerCase() !== username.toLowerCase()) return 0;

  // `redirectOnExpiry: false` because this is a background probe on a page the reader is allowed to see.
  // Left on, a week-old token would answer 401 here, `lib/api.ts` would read that as an ended session, and the shelf that had already painted would be replaced by a login form;
  //   on somebody else's public profile as readily as on your own.
  const { status, body } = await getMyBriefings({ redirectOnExpiry: false });
  if (status !== 200 || typeof body?.total !== "number") return 0;

  // Clamped, because the two totals come from two requests:
  //  filing a briefing between them would otherwise show a negative count.
  return Math.max(0, body.total - published);
}

async function mount(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) return;

  const username = usernameFromLocation();
  const page = pageFromLocation(window.location.search);

  const { shelf, status } = await loadShelf(username, page, document);

  if (!shelf) {
    // "Nobody has that name" and "we could not ask" are different pages.
    // A 404 here is a designed answer, not a failure to report.
    root.innerHTML = status === 404 ? noCuratorMarkup() : shelfErrorMarkup();
    updateNavigation();
    return;
  }

  document.title = `${shelf.username} on Lede`;

  // Painted before the draft count is known, so the page never waits on a request that only ever adds one line to it;
  //  and the owner's own profile is not the slowest one on the site.
  root.innerHTML = shelfMarkup({
    shelf,
    href: (n) => hrefForPage(window.location.pathname, n),
  });

  // After the paint, never before:
  //  the bar this fills in is part of the markup above, so the ids it looks for do not exist until the page has drawn.
  updateNavigation();

  const drafts = await ownDraftCount(shelf.username, shelf.total);
  const slot = document.getElementById(DRAFTS_SLOT);

  // Only the slot's contents, never the shelf again: a redraw here would drop the focus of anybody who had already started tabbing through the cards.
  if (slot && drafts > 0) slot.innerHTML = draftsBandMarkup(drafts);
}

void mount();
