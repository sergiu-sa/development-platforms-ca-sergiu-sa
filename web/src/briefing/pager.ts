/**
 * Paging, for the two shelves that have it: every filed briefing, and one curator's.
 *
 * It lives in its own module rather than in `profile.ts`, where it was written, because `/briefings` needs it too - and a general shelf importing the curator page's module for a component belonging to neither reads as a mistake somebody would copy their way out of.
 *
 * **The reader belongs with the writer.** The first version exported only `pagerMarkup` and left each page to work out its own `?page=` handling, and the two had already drifted in the one commit that created them: one built `?page=2`, the other `/u/name?page=2`. Both resolve, so nothing would have failed - `pagerMarkup` takes the callback and asks nothing of it - and the difference would have sat there until somebody relied on one shape.
 */

import { escapeHtml } from "../lib/html";

/**
 * The page the address is asking for.
 *
 * Anything that is not a page number opens page 1, which is what the server does with the same parameter rather than arguing with it.
 */
export function pageFromLocation(search: string): number {
  const parsed = Number(new URLSearchParams(search).get("page"));

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Where a page number lives.
 *
 * Page 1 is the bare address rather than `?page=1`, so the front of a shelf has one URL instead of two and a shared link to it carries no number anybody has to think about.
 */
export function hrefForPage(pathname: string, page: number): string {
  return page > 1 ? `${pathname}?page=${page}` : pathname;
}

/**
 * Newer and older, and where you are.
 *
 * The unavailable end is not drawn at all - not a disabled anchor and not a dimmed span.
 * A dimmed one was the first attempt and `contrast.test.ts` refused it, correctly: it is visible text at 0.4 against the 0.72 floor, and unlike `.btn:disabled` it is not the inactive *control* WCAG exempts, it is just faint writing.
 * Drawing nothing is better anyway - there is no control to reason about, nothing lands in the tab order, and the grid holds the space so the counter stays centred either way.
 *
 * Returns nothing at all when one page holds everything, because a pager on a shelf of three is furniture describing itself.
 */
export function pagerMarkup(
  page: number,
  pageSize: number,
  total: number,
  href: (page: number) => string
): string {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages < 2) return "";

  // Clamped, because `?page=` is whatever somebody typed.
  // Unclamped it rendered/ "Page 99 of 3" and offered a Newer link to page 98, which is also empty;
  // the one control on a page that has nothing else on it, leading nowhere.
  const current = Math.min(Math.max(page, 1), pages);

  const newer =
    current > 1
      ? `<a class="btn m pager-newer" href="${escapeHtml(href(current - 1))}"><span aria-hidden="true">&larr;</span> Newer</a>`
      : "";

  const older =
    current < pages
      ? `<a class="btn m pager-older" href="${escapeHtml(href(current + 1))}">Older <span aria-hidden="true">&rarr;</span></a>`
      : "";

  return (
    `<nav class="pager" aria-label="More briefings">` +
    newer +
    `<span class="m quiet pager-where">Page ${current} of ${pages}</span>` +
    older +
    `</nav>`
  );
}
